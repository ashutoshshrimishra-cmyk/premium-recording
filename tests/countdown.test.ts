import { describe, expect, it } from 'vitest'
import { countdownTicks, runCountdown } from '../src/renderer/src/recorder/countdown'

describe('countdown', () => {
  it('lists the numbers to show', () => {
    expect(countdownTicks(3)).toEqual([3, 2, 1])
    expect(countdownTicks(0)).toEqual([])
    expect(countdownTicks(-2)).toEqual([])
  })

  it('shows every tick and finishes', async () => {
    const shown: number[] = []
    const waits: number[] = []
    const finished = await runCountdown(
      3,
      (n) => shown.push(n),
      () => false,
      async (ms) => {
        waits.push(ms)
      }
    )
    expect(finished).toBe(true)
    expect(shown).toEqual([3, 2, 1])
    expect(waits).toEqual([1000, 1000, 1000])
  })

  it('stops when cancelled', async () => {
    const shown: number[] = []
    let cancelled = false
    const finished = await runCountdown(
      5,
      (n) => {
        shown.push(n)
        if (n === 4) cancelled = true
      },
      () => cancelled,
      async () => undefined
    )
    expect(finished).toBe(false)
    expect(shown).toEqual([5, 4])
  })

  it('finishes immediately when off', async () => {
    expect(
      await runCountdown(
        0,
        () => undefined,
        () => false,
        async () => undefined
      )
    ).toBe(true)
  })
})
