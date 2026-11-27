const INVOKE_PREFIX = /^Error invoking remote method '[^']*':\s*/
const ERROR_NAME_PREFIX = /^(?:[A-Za-z]*Error):\s*/

/**
 * Electron wraps errors thrown in the main process as
 * "Error invoking remote method 'x': Error: reason". Returns just the reason for the UI.
 */
export function ipcErrorMessage(error: unknown, fallback = 'The action failed'): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const cleaned = raw.replace(INVOKE_PREFIX, '').replace(ERROR_NAME_PREFIX, '').trim()
  return cleaned || fallback
}
