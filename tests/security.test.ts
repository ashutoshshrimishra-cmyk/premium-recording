import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isTopLevelFrame, isTrustedRendererUrl } from '../src/main/ipc/trustedSender'
import { MAX_PATH_LENGTH, looksAbsolutePath } from '../src/shared/pathRules'
import { sanitizeRecent } from '../src/shared/recentRecordings'
import {
  absolutePathSchema,
  recentAddInputSchema,
  recordingStartInputSchema,
  recoveryPathInputSchema,
  setSettingsInputSchema
} from '../src/shared/ipc-schemas'
import { deletePart, listAbandonedParts, recoverPart } from '../src/main/recovery'

describe('trusted renderer URL', () => {
  const posixApp = {
    indexHtmlPath: '/opt/app/resources/app.asar/out/renderer/index.html',
    platform: 'linux' as const
  }
  const winApp = {
    indexHtmlPath:
      'C:\\Program Files\\Premium Recording\\resources\\app.asar\\out\\renderer\\index.html',
    platform: 'win32' as const
  }

  it('accepts the bundled index.html with any view query', () => {
    expect(
      isTrustedRendererUrl('file:///opt/app/resources/app.asar/out/renderer/index.html', posixApp)
    ).toBe(true)
    expect(
      isTrustedRendererUrl(
        'file:///opt/app/resources/app.asar/out/renderer/index.html?view=overlay',
        posixApp
      )
    ).toBe(true)
  })

  it('rejects any other local file', () => {
    expect(isTrustedRendererUrl('file:///tmp/evil.html', posixApp)).toBe(false)
    expect(
      isTrustedRendererUrl('file:///opt/app/resources/app.asar/out/renderer/other.html', posixApp)
    ).toBe(false)
    expect(
      isTrustedRendererUrl(
        'file:///opt/app/resources/app.asar/out/renderer/../../evil/index.html',
        posixApp
      )
    ).toBe(false)
  })

  it('matches Windows paths case-insensitively and decodes spaces', () => {
    expect(
      isTrustedRendererUrl(
        'file:///c:/Program%20Files/Premium%20Recording/resources/app.asar/out/renderer/index.html?view=toolbar',
        winApp
      )
    ).toBe(true)
    expect(isTrustedRendererUrl('file:///C:/Users/x/Downloads/index.html', winApp)).toBe(false)
  })

  it('allows the dev server origin only when configured', () => {
    const dev = { ...posixApp, devServerUrl: 'http://localhost:5173' }
    expect(isTrustedRendererUrl('http://localhost:5173/?view=overlay', dev)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isTrustedRendererUrl('http://localhost:5173/', posixApp)).toBe(false)
    expect(isTrustedRendererUrl('https://example.com/', dev)).toBe(false)
    expect(isTrustedRendererUrl('not a url', dev)).toBe(false)
  })

  it('accepts only top-level frames', () => {
    expect(isTopLevelFrame({ parent: null })).toBe(true)
    expect(isTopLevelFrame({ parent: {} })).toBe(false)
    expect(isTopLevelFrame(null)).toBe(false)
  })
})

describe('path rules', () => {
  it('recognises absolute POSIX, drive and UNC paths', () => {
    expect(looksAbsolutePath('/home/u/v.mp4')).toBe(true)
    expect(looksAbsolutePath('C:\\Videos\\a.mp4')).toBe(true)
    expect(looksAbsolutePath('d:/Videos/a.mp4')).toBe(true)
    expect(looksAbsolutePath('\\\\server\\share\\a.mp4')).toBe(true)
    expect(looksAbsolutePath('Videos\\a.mp4')).toBe(false)
    expect(looksAbsolutePath('C:a.mp4')).toBe(false)
    expect(looksAbsolutePath('')).toBe(false)
  })

  it('bounds path inputs and requires absolute paths', () => {
    expect(absolutePathSchema.safeParse('/a/b.mp4').success).toBe(true)
    expect(absolutePathSchema.safeParse('relative.mp4').success).toBe(false)
    expect(absolutePathSchema.safeParse(`/${'a'.repeat(MAX_PATH_LENGTH)}`).success).toBe(false)
    expect(recoveryPathInputSchema.safeParse({ partPath: 'x.mp4.part' }).success).toBe(false)
    expect(recentAddInputSchema.safeParse({ filePath: 'C:\\a.mp4', durationMs: 1 }).success).toBe(
      true
    )
  })
})

describe('save folder ownership', () => {
  it('drops a renderer supplied save folder from recording start', () => {
    const parsed = recordingStartInputSchema.parse({
      sourceId: 'screen:1:0',
      mimeType: 'video/mp4',
      fps: 30,
      width: 1920,
      height: 1080,
      saveDir: 'C:\\Windows\\System32'
    })
    expect(parsed).not.toHaveProperty('saveDir')
  })

  it('drops a renderer supplied save folder from setSettings', () => {
    const parsed = setSettingsInputSchema.parse({
      saveDir: '\\\\attacker\\share',
      fps: 30,
      resolution: '1080p',
      noiseSuppression: true
    })
    expect(parsed).not.toHaveProperty('saveDir')
    expect(parsed.fps).toBe(30)
  })
})

describe('persisted recent recordings', () => {
  const good = {
    filePath: 'C:\\Videos\\a.mp4',
    sizeBytes: 10,
    durationMs: 1000,
    savedAt: '2026-01-01T00:00:00.000Z'
  }

  it('keeps valid entries and drops damaged ones individually', () => {
    const result = sanitizeRecent([
      good,
      { ...good, filePath: 'relative.mp4' },
      { ...good, filePath: 'C:\\Windows\\notepad.exe' },
      { ...good, sizeBytes: -1 },
      { ...good, savedAt: 'yesterday' },
      { ...good, filePath: '/home/u/b.webm', extra: 'ignored' },
      null,
      'text'
    ])
    expect(result).toEqual([good, { ...good, filePath: '/home/u/b.webm' }])
  })

  it('returns an empty list for a non-array value', () => {
    expect(sanitizeRecent({ items: [] })).toEqual([])
    expect(sanitizeRecent(undefined)).toEqual([])
  })
})

describe('recovery refuses symlinks', () => {
  let dir = ''
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = ''
  })

  it('does not list, recover or delete a symlinked .part', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rec-link-'))
    const target = join(dir, 'outside.bin')
    await writeFile(target, 'secret')
    const link = join(dir, 'Recording_x.mp4.part')
    await symlink(target, link)
    expect(await listAbandonedParts(dir)).toEqual([])
    await expect(recoverPart(link)).rejects.toThrow(/not a regular/)
    await expect(deletePart(link)).rejects.toThrow(/not a regular/)
    expect((await readdir(dir)).sort()).toEqual(['Recording_x.mp4.part', 'outside.bin'])
  })
})
