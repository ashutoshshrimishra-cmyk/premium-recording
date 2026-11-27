import { fileURLToPath } from 'node:url'
import { posix, win32 } from 'node:path'

export interface TrustedRenderer {
  /** Absolute path of the bundled renderer, out/renderer/index.html. */
  indexHtmlPath: string
  /** Dev server URL, only set in development. */
  devServerUrl?: string
  platform: NodeJS.Platform
}

/**
 * True when `url` is this app's renderer: the bundled index.html (any query, for example
 * ?view=overlay) or, in development, a page on the dev server origin. Any other file:// page is
 * rejected.
 */
export function isTrustedRendererUrl(url: string, trusted: TrustedRenderer): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'file:') {
    const windows = trusted.platform === 'win32'
    const paths = windows ? win32 : posix
    let filePath: string
    try {
      filePath = fileURLToPath(parsed, { windows })
    } catch {
      return false
    }
    const actual = paths.resolve(filePath)
    const expected = paths.resolve(trusted.indexHtmlPath)
    // Windows paths are case-insensitive (drive letter case differs between APIs).
    return windows ? actual.toLowerCase() === expected.toLowerCase() : actual === expected
  }
  if (!trusted.devServerUrl) return false
  try {
    return parsed.origin === new URL(trusted.devServerUrl).origin
  } catch {
    return false
  }
}

/** True for the top-level frame of a window. Subframes (iframes) never get IPC access. */
export function isTopLevelFrame(frame: { parent: unknown } | null | undefined): boolean {
  return Boolean(frame) && frame?.parent === null
}
