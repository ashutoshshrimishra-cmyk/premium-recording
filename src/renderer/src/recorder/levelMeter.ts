import { shouldBypassProcessed } from './audioMath'

export const PEAK_HALF_LIFE_MS = 300

export interface LevelMonitorOptions {
  now: () => number
  /** When false the monitor only meters (plain microphone path, nothing to bypass). */
  failsafe: boolean
}

export interface LevelReading {
  raw: number
  processed: number
  /** True once the failsafe has switched to the raw signal. Sticky. */
  bypassed: boolean
  /** True only on the reading that triggered the bypass. */
  justBypassed: boolean
}

/**
 * Peak meter with time based decay, so the displayed fall does not depend on how often it is polled,
 * plus the one-way failsafe: when the raw microphone has signal but the processed chain has never produced
 * any, the output must switch to the raw signal.
 */
export function createLevelMonitor(options: LevelMonitorOptions): {
  sample: (raw: number, processed: number, processedActive: boolean) => LevelReading
} {
  const startedAt = options.now()
  let last = startedAt
  let peakRaw = 0
  let peakProcessed = 0
  let maxProcessed = 0
  let bypassed = false
  return {
    sample: (raw, processed, processedActive) => {
      const t = options.now()
      const decay = 0.5 ** ((t - last) / PEAK_HALF_LIFE_MS)
      last = t
      peakRaw = Math.max(peakRaw * decay, raw)
      peakProcessed = Math.max(peakProcessed * decay, processed)
      maxProcessed = Math.max(maxProcessed, processed)
      let justBypassed = false
      if (
        options.failsafe &&
        !bypassed &&
        processedActive &&
        shouldBypassProcessed(peakRaw, maxProcessed, t - startedAt)
      ) {
        bypassed = true
        justBypassed = true
      }
      return { raw: peakRaw, processed: peakProcessed, bypassed, justBypassed }
    }
  }
}
