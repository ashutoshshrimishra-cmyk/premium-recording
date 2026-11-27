/** Pure helpers that turn recording failures into messages and IPC payloads. No Electron or fs use. */

export const STOP_FAILURE_CODES = ['cancelled', 'empty', 'save-failed', 'error'] as const
export type StopFailureCode = (typeof STOP_FAILURE_CODES)[number]

/** Error codes attached to errors thrown by stopRecordingFile. */
export const RECORDING_CANCELLED = 'RECORDING_CANCELLED'
export const RECORDING_EMPTY = 'RECORDING_EMPTY'

export interface StopFailure {
  ok: false
  code: StopFailureCode
  message: string
  preservedPath?: string
}

const MAX_MESSAGE_LENGTH = 1000

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** A short, user facing reason for a failed file write. Disk full is named explicitly. */
export function describeWriteError(error: unknown): string {
  const code = errorCode(error)
  if (code === 'ENOSPC' || code === 'EDQUOT') {
    return 'Disk full: the drive with the save folder has no free space left'
  }
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return 'Write failed: the save folder can no longer be written to (permission denied)'
  }
  if (code === 'ENOENT' || code === 'ENODEV' || code === 'ENXIO') {
    return 'Write failed: the save folder is no longer available. The drive may have been removed'
  }
  if (code === 'EIO') {
    return 'Write failed: the drive reported an I/O error. It may have been disconnected'
  }
  const detail = error instanceof Error ? error.message : String(error)
  return `Write failed: ${detail}`
}

/** Maps an error from stopping the recording to a structured result the renderer can act on. */
export function toStopFailure(error: unknown): StopFailure {
  const message = (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_MESSAGE_LENGTH
  )
  const code = errorCode(error)
  if (code === RECORDING_CANCELLED) return { ok: false, code: 'cancelled', message }
  if (code === RECORDING_EMPTY) return { ok: false, code: 'empty', message }
  const preserved =
    typeof error === 'object' && error !== null && 'preservedPath' in error
      ? (error as { preservedPath: unknown }).preservedPath
      : undefined
  if (typeof preserved === 'string' && preserved.length > 0) {
    return { ok: false, code: 'save-failed', message, preservedPath: preserved }
  }
  return { ok: false, code: 'error', message }
}
