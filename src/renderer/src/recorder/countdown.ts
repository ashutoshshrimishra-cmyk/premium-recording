export const COUNTDOWN_OPTIONS = [0, 3, 5] as const

/** Numbers shown before recording starts, e.g. 3 gives [3, 2, 1]. */
export function countdownTicks(seconds: number): number[] {
  const count = Math.max(0, Math.floor(seconds))
  return Array.from({ length: count }, (_, index) => count - index)
}

/**
 * Shows each tick for one second. Resolves true when the countdown finished and false when it
 * was cancelled, so the caller can skip starting the recording.
 */
export async function runCountdown(
  seconds: number,
  onTick: (remaining: number) => void,
  isCancelled: () => boolean,
  wait: (ms: number) => Promise<void>
): Promise<boolean> {
  for (const tick of countdownTicks(seconds)) {
    if (isCancelled()) return false
    onTick(tick)
    await wait(1000)
  }
  return !isCancelled()
}
