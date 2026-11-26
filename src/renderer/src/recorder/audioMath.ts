/** Pure audio helpers (level math, frame sizing). Kept free of DOM APIs so they can be unit tested. */

/** RNNoise always works on 10 ms frames at 48 kHz, which is 480 samples. */
export const RNNOISE_SAMPLE_RATE = 48_000
export const RNNOISE_FRAME_SIZE = 480
/** AudioWorklet render quantum. */
export const WORKLET_BLOCK_SIZE = 128

export const METER_FLOOR_DB = -60
export const SILENCE_DB = -100

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Root mean square of a block of samples in the range -1..1. */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

/** Largest absolute sample value. */
export function peak(samples: ArrayLike<number>): number {
  let max = 0
  for (let i = 0; i < samples.length; i += 1) max = Math.max(max, Math.abs(samples[i]))
  return max
}

/** Linear amplitude to dBFS. Silence maps to SILENCE_DB instead of -Infinity. */
export function amplitudeToDb(amplitude: number): number {
  if (!(amplitude > 0)) return SILENCE_DB
  return Math.max(SILENCE_DB, 20 * Math.log10(amplitude))
}

export function dbToAmplitude(db: number): number {
  return 10 ** (db / 20)
}

/** Maps dBFS to a 0..1 meter position, with `floorDb` at 0 and 0 dBFS at 1. */
export function dbToMeter(db: number, floorDb = METER_FLOOR_DB): number {
  return clamp((db - floorDb) / (0 - floorDb), 0, 1)
}

/** Meter smoothing: rises quickly, falls slowly. */
export function smoothMeter(previous: number, next: number, attack = 0.6, release = 0.12): number {
  const factor = next > previous ? attack : release
  return previous + (next - previous) * factor
}

/** Number of 128-sample worklet blocks needed to fill whole RNNoise frames. */
export function blocksPerRnnoiseFrame(
  frameSize = RNNOISE_FRAME_SIZE,
  blockSize = WORKLET_BLOCK_SIZE
): number {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  return frameSize / gcd(frameSize, blockSize)
}

/** Latency in milliseconds that RNNoise frame buffering adds. */
export function rnnoiseLatencyMs(
  sampleRate = RNNOISE_SAMPLE_RATE,
  frameSize = RNNOISE_FRAME_SIZE
): number {
  return (frameSize / sampleRate) * 1000
}

export function meterLevelFromSamples(samples: ArrayLike<number>): number {
  return dbToMeter(amplitudeToDb(rms(samples)))
}
