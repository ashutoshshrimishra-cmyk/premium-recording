/** Pure state decisions for the recording session in the main process. No Electron use. */

export type SessionPhase = 'starting' | 'recording' | 'stopping'

/** What happens to the recording file when a session is torn down. */
export type FileTeardown = 'discard' | 'keep' | 'none'

/**
 * When the recording window goes away (closed, crashed), a session that is still starting has no
 * data yet, so its file is discarded. A running recording keeps its .part for recovery. While
 * stopping, the stop call owns the file and finishes it.
 */
export function ownerLossTeardown(phase: SessionPhase): FileTeardown {
  if (phase === 'starting') return 'discard'
  if (phase === 'recording') return 'keep'
  return 'none'
}

/** True when the startup of `sessionId` must stop because its session was torn down or replaced. */
export function isStartupCancelled(
  active: { id: string; tornDown: boolean } | undefined,
  sessionId: string
): boolean {
  return !active || active.id !== sessionId || active.tornDown
}

/**
 * Wraps an async teardown so it runs once. Every later call returns the same promise, and a
 * failing teardown resolves (after `onError`) so callers in `finally` blocks never throw.
 */
export function once(
  run: () => Promise<void>,
  onError: (error: unknown) => void
): () => Promise<void> {
  let pending: Promise<void> | undefined
  return () => {
    pending ??= Promise.resolve()
      .then(run)
      .catch((error: unknown) => onError(error))
    return pending
  }
}
