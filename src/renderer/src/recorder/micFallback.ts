import { ipcErrorMessage } from './ipcError'

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
  | { kind: 'saved'; filePath: string }
  | { kind: 'error'; message: string; keptAtPath: boolean; preservedPath?: string }

/** Result of the main process stop call (see recordingStopOutputSchema). */
export type StopResult =
  | { ok: true; filePath: string }
  | { ok: false; code: string; message: string; preservedPath?: string }

export const RECOVERY_HINT = 'Use Recover in the "Unfinished recordings" list to save it.'

/**
 * Closes the recording file. Chunk write errors never request a discard, so the partial data
 * stays on disk. A failed stop names the kept .part and points to recovery. A rejected stop call
 * (IPC failure) still produces an error outcome, so the caller can always reset the UI.
 */
export async function closeRecordingFile(
  stop: (args: { discard: boolean }) => Promise<StopResult>,
  chunkWriteError: Error | undefined
): Promise<StopOutcome> {
  let result: StopResult
  try {
    result = await stop({ discard: false })
  } catch (error) {
    result = {
      ok: false,
      code: 'error',
      message: ipcErrorMessage(error, 'Could not close the recording')
    }
  }
  if (result.ok) {
    if (chunkWriteError) {
      return {
        kind: 'error',
        message: chunkWriteFailureMessage(chunkWriteError, result.filePath),
        keptAtPath: true
      }
    }
    return { kind: 'saved', filePath: result.filePath }
  }
  const preservedPath = result.preservedPath
  if (!preservedPath) {
    return {
      kind: 'error',
      message: chunkWriteError ? chunkWriteFailureMessage(chunkWriteError) : result.message,
      keptAtPath: false
    }
  }
  const reason = chunkWriteError
    ? `Chunk write failed: ${chunkWriteError.message}. ${result.message}`
    : result.message
  return {
    kind: 'error',
    message: /\.part$/i.test(preservedPath) ? `${reason}. ${RECOVERY_HINT}` : reason,
    keptAtPath: true,
    preservedPath
  }
}
