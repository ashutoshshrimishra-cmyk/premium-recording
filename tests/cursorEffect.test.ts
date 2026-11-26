import { describe, expect, it } from 'vitest'
import {
  RIPPLE_DURATION_MS,
  addRipple,
  createRippleState,
  defaultCursorEffect,
  hasConverged,
  smoothPosition,
  stepRipples
} from '../src/renderer/src/overlay/cursorEffect'
import { sameSample, toDisplayRelative } from '../src/main/windows/cursorMath'

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
