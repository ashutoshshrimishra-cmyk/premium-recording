import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deletePart,
  isRecoverablePartPath,
  listAbandonedParts,
  recoverPart
} from '../src/main/recovery'

let dir = ''
const make = async (): Promise<string> => (dir = await mkdtemp(join(tmpdir(), 'rec-recover-')))
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('recovery', () => {
  it('lists only abandoned .part files and skips the active one', async () => {
    await make()
    await writeFile(join(dir, 'Recording_a.mp4.part'), 'aaa')
    await writeFile(join(dir, 'Recording_b.webm.part'), 'bb')
    await writeFile(join(dir, 'Recording_c.mp4'), 'c')
    await writeFile(join(dir, 'notes.txt.part'), 'n')
    const active = join(dir, 'Recording_b.webm.part')
    const parts = await listAbandonedParts(dir, active)
    expect(parts.map((p) => p.partPath)).toEqual([join(dir, 'Recording_a.mp4.part')])
    expect(parts[0].sizeBytes).toBe(3)
    expect(parts[0].suggestedFinalPath).toBe(join(dir, 'Recording_a.mp4'))
  })

  it('returns an empty list for a missing directory', async () => {
    await make()
    expect(await listAbandonedParts(join(dir, 'nope'))).toEqual([])
  })

  it('recovers without overwriting an existing file', async () => {
    await make()
    await writeFile(join(dir, 'Recording_a.mp4'), 'existing')
    await writeFile(join(dir, 'Recording_a.mp4.part'), 'recovered')
    const result = await recoverPart(join(dir, 'Recording_a.mp4.part'))
    expect(result).toBe(join(dir, 'Recording_a_2.mp4'))
    expect(await readFile(join(dir, 'Recording_a.mp4'), 'utf8')).toBe('existing')
    expect(await readFile(result, 'utf8')).toBe('recovered')
    expect(await readdir(dir)).not.toContain('Recording_a.mp4.part')
  })

  it('removes an empty part instead of recovering it', async () => {
    await make()
    const part = join(dir, 'Recording_e.mp4.part')
    await writeFile(part, '')
    await expect(recoverPart(part)).rejects.toThrow('empty')
    expect(await readdir(dir)).toEqual([])
  })

  it('deletes a part', async () => {
    await make()
    const part = join(dir, 'Recording_d.mp4.part')
    await writeFile(part, 'd')
    await deletePart(part)
    expect(await readdir(dir)).toEqual([])
  })

  it('validates paths against the save dir', async () => {
    await make()
    expect(isRecoverablePartPath(dir, join(dir, 'Recording_a.mp4.part'))).toBe(true)
    expect(isRecoverablePartPath(dir, join(dir, 'Recording_a.mp4'))).toBe(false)
    expect(isRecoverablePartPath(dir, join(dir, '..', 'Recording_a.mp4.part'))).toBe(false)
    expect(isRecoverablePartPath(dir, join(dir, 'sub', 'Recording_a.mp4.part'))).toBe(false)
    expect(isRecoverablePartPath(dir, 'relative.mp4.part')).toBe(false)
  })
})
