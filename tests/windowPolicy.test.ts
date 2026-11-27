import { describe, expect, it, vi } from 'vitest'
import {
  loadWithRetry,
  withTimeout,
  LOAD_TIMEOUT_MS,
  LOAD_ATTEMPTS
} from '../src/main/windows/loadPolicy'
import { isSenderOf } from '../src/main/windows/senderGate'
import { isPointInRect } from '../src/main/windows/cursorMath'
import { isProbePathAllowed } from '../src/main/ipc/probePath'
import { addRipple, createRippleState } from '../src/renderer/src/overlay/cursorEffect'

describe('load policy', () => {
  it('allows a cold packaged start and one retry', () => {
    expect(LOAD_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000)
    expect(LOAD_ATTEMPTS).toBeGreaterThanOrEqual(2)
  })

  it('retries once and then succeeds', async () => {
    const attempt = vi.fn(async (index: number) => {
      if (index === 0) throw new Error('slow')
    })
    const onRetry = vi.fn()
    await loadWithRetry(attempt, 2, onRetry)
    expect(attempt).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('throws the last error when every attempt fails', async () => {
    await expect(
      loadWithRetry(async (index) => {
        throw new Error(`fail ${index}`)
      }, 2)
    ).rejects.toThrow('fail 1')
  })

  it('times out a promise that never settles', async () => {
    vi.useFakeTimers()
    const result = expect(
      withTimeout(new Promise<void>(() => undefined), 100, 'late')
    ).rejects.toThrow('late')
    await vi.advanceTimersByTimeAsync(101)
    await result
    vi.useRealTimers()
  })
})

describe('window policies', () => {
  it('gates senders by live window identity', () => {
    const live = { id: 7, isDestroyed: () => false }
    expect(isSenderOf(live, 7)).toBe(true)
    expect(isSenderOf(live, 8)).toBe(false)
    expect(isSenderOf({ id: 7, isDestroyed: () => true }, 7)).toBe(false)
    expect(isSenderOf(undefined, 7)).toBe(false)
  })

  it('ignores clicks inside the panel bounds', () => {
    const panel = { x: 100, y: 100, width: 50, height: 200 }
    expect(isPointInRect({ x: 120, y: 150 }, panel)).toBe(true)
    expect(isPointInRect({ x: 150, y: 150 }, panel)).toBe(false)
    expect(isPointInRect({ x: 1, y: 1 }, undefined)).toBe(false)
  })

  it('limits the saved-file probe to the last saved recording', () => {
    const saved = process.platform === 'win32' ? 'C:\\rec\\a.mp4' : '/rec/a.mp4'
    const other = process.platform === 'win32' ? 'C:\\rec\\b.mp4' : '/rec/b.mp4'
    expect(isProbePathAllowed(saved, saved)).toBe(true)
    expect(isProbePathAllowed(other, saved)).toBe(false)
    expect(isProbePathAllowed(saved, undefined)).toBe(false)
    expect(isProbePathAllowed('rel.mp4', 'rel.mp4')).toBe(false)
  })

  it('does not double a ripple reported by both the DOM fallback and the hook', () => {
    const state = createRippleState()
    expect(addRipple(state, 100, 100, 1000)).toBe(true)
    expect(addRipple(state, 102, 101, 1050)).toBe(false)
    expect(addRipple(state, 300, 300, 1050)).toBe(true)
    expect(addRipple(state, 100, 100, 1400)).toBe(true)
  })
})
