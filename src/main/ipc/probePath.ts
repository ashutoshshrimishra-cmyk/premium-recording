import { isAbsolute, resolve } from 'node:path'

/** The saved-file audio check may only read the recording that was just saved. */
export function isProbePathAllowed(filePath: string, lastSavedPath: string | undefined): boolean {
  if (!lastSavedPath || !isAbsolute(filePath)) return false
  if (!/\.(mp4|webm)$/i.test(filePath)) return false
  return resolve(filePath) === resolve(lastSavedPath)
}
