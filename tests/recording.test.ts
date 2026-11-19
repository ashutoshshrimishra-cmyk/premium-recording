import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appendRecordingChunk,
  generateRecordingFilename,
  hasEnoughDiskSpace,
  startRecordingFile,
  stopRecordingFile
} from '../src/main/recording'

describe('recording helpers', () => {
  it('generates timestamped mp4 and webm filenames', () => {
    const date = new Date(2026, 10, 19, 9, 8, 7)
    expect(generateRecordingFilename(date, 'video/mp4')).toBe('Recording_2026-11-19_09-08-07.mp4')
    expect(generateRecordingFilename(date, 'video/webm;codecs=vp9')).toBe(
      'Recording_2026-11-19_09-08-07.webm'
    )
  })

  it('checks the minimum writable disk capacity', () => {
    expect(hasEnoughDiskSpace(101 * 1024 * 1024)).toBe(true)
    expect(hasEnoughDiskSpace(99 * 1024 * 1024)).toBe(false)
  })

  it('persists chunk data before finalizing the recording file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'premium-recording-test-'))
    try {
      await startRecordingFile(directory, new Date(2026, 10, 19, 9, 8, 7))
      const chunk = new TextEncoder().encode('recording chunk').buffer
      expect(await appendRecordingChunk(chunk)).toBe(true)

      const filePath = await stopRecordingFile('video/webm')
      expect(filePath.endsWith('.webm')).toBe(true)
      expect(await readFile(filePath, 'utf8')).toBe('recording chunk')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('refuses to keep a 0-byte file and reports it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'premium-recording-test-'))
    try {
      await startRecordingFile(directory, new Date(2026, 10, 19, 9, 8, 7))
      await expect(stopRecordingFile('video/mp4')).rejects.toThrow(/0 bytes/)
      expect(await readdir(directory)).toHaveLength(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('deletes the file when a recording is discarded', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'premium-recording-test-'))
    try {
      await startRecordingFile(directory, new Date(2026, 10, 19, 9, 8, 7), 'video/webm')
      await expect(stopRecordingFile('video/webm', true)).rejects.toThrow(/cancelled/)
      expect(await readdir(directory)).toHaveLength(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('accepts typed-array chunks as well as ArrayBuffers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'premium-recording-test-'))
    try {
      await startRecordingFile(directory, new Date(2026, 10, 19, 9, 8, 7))
      expect(await appendRecordingChunk(new TextEncoder().encode('abc'))).toBe(true)
      const filePath = await stopRecordingFile('video/mp4')
      expect(await readFile(filePath, 'utf8')).toBe('abc')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
