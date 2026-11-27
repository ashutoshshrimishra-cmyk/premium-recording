import { describe, expect, it, vi } from 'vitest'
import {
  chunkWriteFailureMessage,
  classifyMicFailure,
  openMicrophoneWithFallback,
  shouldDiscardOnWriteError
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
    ).rejects.toThrow('Recording was cancelled')
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
  it('keeps the data', () => {
    expect(shouldDiscardOnWriteError()).toBe(false)
  })

  it('reports the failure and saved path', () => {
    const message = chunkWriteFailureMessage(new Error('disk full'), 'C:\\a.webm')
    expect(message).toContain('Chunk write failed')
    expect(message).toContain('C:\\a.webm')
  })
})
