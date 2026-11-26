import { describe, expect, it } from 'vitest'
import { createLevelMonitor } from '../src/renderer/src/recorder/levelMeter'

describe('createLevelMonitor', () => {
  it('meters the plain path without ever bypassing', () => {
    let t = 0
    const monitor = createLevelMonitor({ now: () => t, failsafe: false })
    t = 5000
    const reading = monitor.sample(0.5, 0.5, true)
    expect(reading.raw).toBe(0.5)
    expect(reading.bypassed).toBe(false)
  })

  it('bypasses once when raw has signal and the processed chain stays silent', () => {
    let t = 0
    const monitor = createLevelMonitor({ now: () => t, failsafe: true })
    t = 1000
    expect(monitor.sample(0.3, 0, true).bypassed).toBe(false)
    t = 2500
    const first = monitor.sample(0.3, 0, true)
    expect(first.justBypassed).toBe(true)
    t = 3000
    const second = monitor.sample(0.3, 0, true)
    expect(second.bypassed).toBe(true)
    expect(second.justBypassed).toBe(false)
  })

  it('does not bypass a chain that has produced sound', () => {
    let t = 0
    const monitor = createLevelMonitor({ now: () => t, failsafe: true })
    t = 500
    monitor.sample(0.3, 0.2, true)
    t = 4000
    expect(monitor.sample(0.3, 0, true).bypassed).toBe(false)
  })

  it('decays by elapsed time, not by call count', () => {
    let t = 0
    const monitor = createLevelMonitor({ now: () => t, failsafe: false })
    monitor.sample(1, 1, false)
    t = 300
    expect(monitor.sample(0, 0, false).raw).toBeCloseTo(0.5, 5)
    const dense = createLevelMonitor({ now: () => t, failsafe: false })
    t = 0
    dense.sample(1, 1, false)
    let last = 1
    for (t = 10; t <= 300; t += 10) last = dense.sample(0, 0, false).raw
    expect(last).toBeCloseTo(0.5, 5)
  })
})
