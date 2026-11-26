import { describe, expect, it } from 'vitest'
import {
  SILENCE_DB,
  amplitudeToDb,
  blocksPerRnnoiseFrame,
  clamp,
  dbToAmplitude,
  dbToMeter,
  meterLevelFromSamples,
  peak,
  rms,
  rnnoiseLatencyMs,
  smoothMeter
} from '../src/renderer/src/recorder/audioMath'

describe('audioMath', () => {
  it('computes rms and peak', () => {
    expect(rms([])).toBe(0)
    expect(rms([1, -1, 1, -1])).toBe(1)
    expect(rms([0.5, 0.5])).toBeCloseTo(0.5)
    expect(peak([0.1, -0.7, 0.3])).toBe(0.7)
  })

  it('converts amplitude and dB', () => {
    expect(amplitudeToDb(1)).toBeCloseTo(0)
    expect(amplitudeToDb(0.5)).toBeCloseTo(-6.02, 1)
    expect(amplitudeToDb(0)).toBe(SILENCE_DB)
    expect(dbToAmplitude(-20)).toBeCloseTo(0.1)
  })

  it('maps dB to a clamped meter value', () => {
    expect(dbToMeter(0)).toBe(1)
    expect(dbToMeter(-60)).toBe(0)
    expect(dbToMeter(-30)).toBeCloseTo(0.5)
    expect(dbToMeter(10)).toBe(1)
    expect(dbToMeter(-100)).toBe(0)
    expect(clamp(5, 0, 1)).toBe(1)
  })

  it('smooths with fast attack and slow release', () => {
    const up = smoothMeter(0, 1)
    const down = smoothMeter(1, 0)
    expect(up).toBeGreaterThan(1 - down)
    expect(smoothMeter(0.4, 0.4)).toBeCloseTo(0.4)
  })

  it('sizes RNNoise frames against 128-sample worklet blocks', () => {
    expect(blocksPerRnnoiseFrame()).toBe(15)
    expect(rnnoiseLatencyMs()).toBe(10)
  })

  it('gives silence a zero meter level', () => {
    expect(meterLevelFromSamples(new Float32Array(256))).toBe(0)
    expect(meterLevelFromSamples(new Float32Array(256).fill(1))).toBe(1)
  })
})
