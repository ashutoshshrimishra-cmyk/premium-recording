/**
 * setContentProtection excludes a window from capture only on Windows 10 2004 (build 19041) or later.
 * Older builds show a black rectangle instead. `release` is os.release(), for example "10.0.19045".
 */
export const MIN_CAPTURE_EXCLUSION_BUILD = 19041

export function supportsCaptureExclusion(platform: string, release: string): boolean {
  if (platform !== 'win32') return true
  const parts = release.split('.').map((part) => Number.parseInt(part, 10))
  const major = parts[0]
  const build = parts[2]
  if (!Number.isFinite(major) || !Number.isFinite(build)) return true
  if (major > 10) return true
  return major === 10 && build >= MIN_CAPTURE_EXCLUSION_BUILD
}
