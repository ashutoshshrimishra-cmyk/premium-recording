/** A cold packaged start (antivirus scan, GPU process start) can take well over 3 s. */
export const LOAD_TIMEOUT_MS = 15_000
export const LOAD_ATTEMPTS = 2

/** Rejects when `promise` does not settle within `ms`. The timer is always cleared. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/** Runs `attempt` up to `attempts` times, calling `onRetry` between failures. Throws the last error. */
export async function loadWithRetry(
  attempt: (index: number) => Promise<void>,
  attempts: number,
  onRetry?: (error: unknown, index: number) => void
): Promise<void> {
  let lastError: unknown
  for (let index = 0; index < attempts; index += 1) {
    try {
      await attempt(index)
      return
    } catch (error) {
      lastError = error
      if (index < attempts - 1) onRetry?.(error, index)
    }
  }
  throw lastError
}
