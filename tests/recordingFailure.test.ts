import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    link: vi.fn(async () => {
      throw Object.assign(new Error('EIO: simulated link failure'), { code: 'EIO' })
    })
  }
})

import {
  appendRecordingChunk,
  RecordingSaveError,
  startRecordingFile,
  stopRecordingFile
} from '../src/main/recording'

let dir = ''
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('failed finalize', () => {
  it('keeps the .part with its data and reports its path', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rec-fail-'))
    await startRecordingFile(dir)
    await appendRecordingChunk(Buffer.from('precious'))
    const error = await stopRecordingFile('video/mp4').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RecordingSaveError)
    const preserved = (error as RecordingSaveError).preservedPath
    expect((error as Error).message).toContain(preserved)
    expect(await readFile(preserved, 'utf8')).toBe('precious')
    expect(await readdir(dir)).toEqual([expect.stringMatching(/\.part$/)])
  })

  it('deletes the .part on explicit discard', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rec-fail-'))
    await startRecordingFile(dir)
    await appendRecordingChunk(Buffer.from('x'))
    await expect(stopRecordingFile('video/mp4', true)).rejects.toThrow('cancelled')
    expect(await readdir(dir)).toEqual([])
  })

  it('deletes a 0-byte .part', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rec-fail-'))
    await startRecordingFile(dir)
    await expect(stopRecordingFile('video/mp4')).rejects.toThrow('0 bytes')
    expect(await readdir(dir)).toEqual([])
  })
})
