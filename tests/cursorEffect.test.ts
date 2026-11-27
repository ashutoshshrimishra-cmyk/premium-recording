import { describe, expect, it } from 'vitest'
import {
  RIPPLE_DURATION_MS,
  addRipple,
  createRippleState,
  cursorEffectsActive,
  defaultCursorEffect,
  hasConverged,
  smoothPosition,
  stepRipples
} from '../src/renderer/src/overlay/cursorEffect'
import {
  CURSOR_IDLE_AFTER_MS,
  CURSOR_IDLE_POLL_MS,
  CURSOR_POLL_MS,
  displayChangeAction,
  nextCursorPollDelay,
  sameSample,
  toDisplayRelative
} from '../src/main/windows/cursorMath'

describe('cursor effect', () => {
  it('has the documented defaults', () => {
    expect(defaultCursorEffect).toMatchObject({
      highlight: true,
      ripple: true,
      drawPointer: false,
      radius: 28
    })
  })

  it('expires ripples after 600 ms with monotonic progress', () => {
    const state = createRippleState()
    addRipple(state, 10, 20, 1000)
    let last = -1
    for (const t of [1000, 1100, 1300, 1599]) {
      const [ripple] = stepRipples(state, t)
      expect(ripple.progress).toBeGreaterThanOrEqual(last)
      last = ripple.progress
    }
    expect(last).toBeLessThan(1)
    expect(RIPPLE_DURATION_MS).toBe(600)
    expect(stepRipples(state, 1600)).toEqual([])
    expect(state.ripples).toHaveLength(0)
  })

  it('smoothPosition starts at the target and converges', () => {
    expect(smoothPosition(undefined, { x: 5, y: 6 }, 0.5)).toEqual({ x: 5, y: 6 })
    let shown = { x: 0, y: 0 }
    const target = { x: 100, y: 50 }
    for (let i = 0; i < 20; i += 1) shown = smoothPosition(shown, target, 0.5)
    expect(hasConverged(shown, target)).toBe(true)
  })
})

describe('cursor math', () => {
  const bounds = { x: 1920, y: 0, width: 1920, height: 1080 }
  it('subtracts the display origin', () => {
    expect(toDisplayRelative({ x: 2000, y: 100 }, bounds)).toEqual({ x: 80, y: 100, inside: true })
  })
  it('flags points outside the display', () => {
    expect(toDisplayRelative({ x: 100, y: 100 }, bounds).inside).toBe(false)
  })
  it('detects unchanged samples', () => {
    const sample = { x: 1, y: 2, inside: true }
    expect(sameSample(sample, { ...sample })).toBe(true)
    expect(sameSample(undefined, sample)).toBe(false)
  })
})

describe('cursor layer idle decision', () => {
  it('is idle only when every effect is off', () => {
    const off = { ...defaultCursorEffect, highlight: false, ripple: false, drawPointer: false }
    expect(cursorEffectsActive(off)).toBe(false)
    expect(cursorEffectsActive({ ...off, highlight: true })).toBe(true)
    expect(cursorEffectsActive({ ...off, ripple: true })).toBe(true)
    expect(cursorEffectsActive({ ...off, drawPointer: true })).toBe(true)
  })
})

describe('cursor polling backoff', () => {
  it('polls fast while moving and slower once the pointer rests', () => {
    expect(nextCursorPollDelay(0)).toBe(CURSOR_POLL_MS)
    expect(nextCursorPollDelay(CURSOR_IDLE_AFTER_MS - 1)).toBe(CURSOR_POLL_MS)
    expect(nextCursorPollDelay(CURSOR_IDLE_AFTER_MS)).toBe(CURSOR_IDLE_POLL_MS)
    expect(CURSOR_IDLE_POLL_MS).toBeLessThanOrEqual(50)
  })
})

describe('display change handling', () => {
  it('reacts only to the recorded display', () => {
    expect(displayChangeAction(1, 2, 'metrics')).toBe('ignore')
    expect(displayChangeAction(1, 2, 'removed')).toBe('ignore')
    expect(displayChangeAction(undefined, 1, 'removed')).toBe('ignore')
    expect(displayChangeAction(1, 1, 'metrics')).toBe('resize')
    expect(displayChangeAction(1, 1, 'removed')).toBe('close-canvas')
  })
})
