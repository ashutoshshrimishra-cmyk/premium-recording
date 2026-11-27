export type MicFailureKind = 'denied' | 'not-found' | 'in-use' | 'other'

export interface MicFailure {
  kind: MicFailureKind
  message: string
}

export class RecordingCancelledError extends Error {
  constructor(cause?: unknown) {
    super('Recording was cancelled', { cause })
    this.name = 'RecordingCancelledError'
  }
}

export type MicChoice = 'retry' | 'video-only' | 'cancel'

export function classifyMicFailure(error: unknown): MicFailure {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      kind: 'denied',
      message: 'Microphone access was denied. Allow microphone access for this app in Windows.'
    }
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return {
      kind: 'not-found',
      message: 'The selected microphone was not found. It may be unplugged or disabled.'
    }
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return {
      kind: 'in-use',
      message: 'The microphone could not be opened. Another app may be using it.'
    }
  }
  const detail = error instanceof Error ? error.message : String(error)
  return { kind: 'other', message: `Could not use the selected microphone: ${detail}` }
}

export async function openMicrophoneWithFallback<T>(
  open: () => Promise<T>,
  askUser: (failure: MicFailure) => Promise<MicChoice>,
  isCancelled: () => boolean
): Promise<{ microphone?: T; videoOnly: boolean }> {
  for (;;) {
    try {
      return { microphone: await open(), videoOnly: false }
    } catch (error) {
      const choice = await askUser(classifyMicFailure(error))
      if (choice === 'cancel' || isCancelled()) throw new RecordingCancelledError(error)
      if (choice === 'video-only') return { videoOnly: true }
    }
  }
}

export function chunkWriteFailureMessage(error: Error, savedPath?: string): string {
  return savedPath
    ? `Chunk write failed: ${error.message}. The partial recording was kept at ${savedPath}`
    : `Chunk write failed: ${error.message}. Any data already written was kept.`
}

export type StopOutcome =
  { kind: 'saved'; filePath: string } | { kind: 'error'; message: string; keptAtPath: boolean }

/**
 * Closes the recording file. Chunk write errors never request a discard, so the
 * partial data stays on disk. Errors from the stop call keep their message when it
 * names the kept file (the main process includes the path).
 */
export async function closeRecordingFile(
  stop: (args: { discard: boolean }) => Promise<{ filePath: string }>,
  chunkWriteError: Error | undefined
): Promise<StopOutcome> {
  try {
    const result = await stop({ discard: false })
    if (chunkWriteError) {
      return {
        kind: 'error',
        message: chunkWriteFailureMessage(chunkWriteError, result.filePath),
        keptAtPath: true
      }
    }
    return { kind: 'saved', filePath: result.filePath }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Could not close the recording'
    if (!chunkWriteError)
      return { kind: 'error', message: reason, keptAtPath: reason.includes('kept at') }
    const names = reason.includes('kept at')
    return {
      kind: 'error',
      message: names
        ? `Chunk write failed: ${chunkWriteError.message}. ${reason}`
        : chunkWriteFailureMessage(chunkWriteError),
      keptAtPath: names
    }
  }
}
