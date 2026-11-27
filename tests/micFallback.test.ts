import { describe, expect, it, vi } from 'vitest'
import {
  chunkWriteFailureMessage,
  classifyMicFailure,
  openMicrophoneWithFallback,
  closeRecordingFile,
  RecordingCancelledError
} from '../src/renderer/src/recorder/micFallback'

const named = (name: string): Error => Object.assign(new Error('x'), { name })

describe('classifyMicFailure', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'not-found'],
    ['OverconstrainedError', 'not-found'],
    ['NotReadableError', 'in-use'],
    ['AbortError', 'in-use'],
    ['TypeError', 'other']
  ])('%s -> %s', (name, kind) => {
    expect(classifyMicFailure(named(name)).kind).toBe(kind)
  })

  it('handles non-error values', () => {
    expect(classifyMicFailure('boom').kind).toBe('other')
  })
})

describe('openMicrophoneWithFallback', () => {
  it('never prompts when the first attempt succeeds', async () => {
    const ask = vi.fn()
    const result = await openMicrophoneWithFallback(
      async () => 'mic',
      ask,
      () => false
    )
    expect(result).toEqual({ microphone: 'mic', videoOnly: false })
    expect(ask).not.toHaveBeenCalled()
  })

  it('retries then succeeds', async () => {
    const open = vi.fn().mockRejectedValueOnce(named('NotReadableError')).mockResolvedValue('mic')
    const ask = vi.fn().mockResolvedValue('retry')
    const result = await openMicrophoneWithFallback(open, ask, () => false)
    expect(result.microphone).toBe('mic')
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('retries then goes video only', async () => {
    const open = vi.fn().mockRejectedValue(named('NotFoundError'))
    const ask = vi.fn().mockResolvedValueOnce('retry').mockResolvedValueOnce('video-only')
    const result = await openMicrophoneWithFallback(open, ask, () => false)
    expect(result).toEqual({ videoOnly: true })
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('throws on cancel', async () => {
    const open = vi.fn().mockRejectedValue(named('NotAllowedError'))
    await expect(
      openMicrophoneWithFallback(
        open,
        async () => 'cancel',
        () => false
      )
    ).rejects.toBeInstanceOf(RecordingCancelledError)
  })

  it('throws when cancelled while the prompt was open', async () => {
    const open = vi.fn().mockRejectedValue(named('NotAllowedError'))
    await expect(
      openMicrophoneWithFallback(
        open,
        async () => 'video-only',
        () => true
      )
    ).rejects.toThrow('Recording was cancelled')
  })
})

describe('chunk write failure handling', () => {
  it('never requests a discard when closing after a chunk error', async () => {
    const stop = vi.fn().mockResolvedValue({ filePath: 'C:\\a.webm' })
    const outcome = await closeRecordingFile(stop, new Error('disk full'))
    expect(stop).toHaveBeenCalledWith({ discard: false })
    expect(outcome).toMatchObject({ kind: 'error', keptAtPath: true })
    expect(outcome.kind === 'error' && outcome.message).toContain('C:\\a.webm')
  })

  it('keeps the kept path when stop also fails', async () => {
    const stop = vi
      .fn()
      .mockRejectedValue(new Error('Link failed. The partial recording was kept at C:\\b.part'))
    const outcome = await closeRecordingFile(stop, new Error('disk full'))
    expect(outcome.kind === 'error' && outcome.message).toContain('Chunk write failed: disk full')
    expect(outcome.kind === 'error' && outcome.message).toContain('C:\\b.part')
  })

  it('falls back to a generic note when the stop error has no path', async () => {
    const stop = vi.fn().mockRejectedValue(new Error('boom'))
    const outcome = await closeRecordingFile(stop, new Error('disk full'))
    expect(outcome).toMatchObject({ kind: 'error', keptAtPath: false })
  })

  it('returns the saved path without a chunk error', async () => {
    const stop = vi.fn().mockResolvedValue({ filePath: 'C:\\ok.webm' })
    expect(await closeRecordingFile(stop, undefined)).toEqual({
      kind: 'saved',
      filePath: 'C:\\ok.webm'
    })
  })

  it('reports the failure and saved path', () => {
    const message = chunkWriteFailureMessage(new Error('disk full'), 'C:\\a.webm')
    expect(message).toContain('Chunk write failed')
    expect(message).toContain('C:\\a.webm')
  })
})
