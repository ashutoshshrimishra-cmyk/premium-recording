/** Path checks shared by the IPC schemas (main and renderer). No Node imports. */

/** Long enough for Windows long paths in practice, short enough to stop abuse. */
export const MAX_PATH_LENGTH = 4096

/** Absolute POSIX path, Windows drive path (C:\ or C:/) or UNC path (\\server\share). */
export function looksAbsolutePath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\[^\\]|\/)/.test(value)
}
