/**
 * setContentProtection excludes a window from capture only on Windows 10 2004 (build 19041) or later.
 * Older builds show a black rectangle instead, and there is no native hook here to erase the panel
 * pixels, so on those builds the panel cannot be both visible and absent from the video.
 * `release` is os.release(), for example "10.0.19045".
 */
export const MIN_CAPTURE_EXCLUSION_BUILD = 19041

export type CaptureExclusionMode = 'exclude' | 'include-unprotected'

/** Extracts the Windows build number from os.release(), for example 19045 from "10.0.19045". */
export function parseWindowsBuild(release: string): number | null {
  const parts = release.split('.')
  if (parts.length < 3) return null
  const build = Number.parseInt(parts[2], 10)
  return Number.isFinite(build) && build >= 0 ? build : null
}

/**
 * Decides how the annotation panel is treated by screen capture. On old Windows builds
 * setContentProtection paints a black box, so protection stays off and the panel is simply visible.
 * Unparsable releases and other platforms assume exclusion works.
 */
export function captureExclusionMode(platform: string, release: string): CaptureExclusionMode {
  if (platform !== 'win32') return 'exclude'
  const build = parseWindowsBuild(release)
  if (build === null) return 'exclude'
  return build >= MIN_CAPTURE_EXCLUSION_BUILD ? 'exclude' : 'include-unprotected'
}

export function describeCaptureMode(
  platform: string,
  release: string,
  mode: CaptureExclusionMode
): string {
  const build = platform === 'win32' ? parseWindowsBuild(release) : null
  return `${build === null ? `${platform} ${release}` : `Windows build ${build}`}, panel capture: ${mode}`
}

export interface PanelProtectionPlan {
  protect: boolean
  logLevel: 'info' | 'warn'
  message: string
}

/** Pure decision for the overlay: whether to call setContentProtection(true) and what to log. */
export function panelProtectionPlan(platform: string, release: string): PanelProtectionPlan {
  const mode = captureExclusionMode(platform, release)
  const detail = describeCaptureMode(platform, release, mode)
  return mode === 'exclude'
    ? { protect: true, logLevel: 'info', message: `Panel content protection on (${detail})` }
    : {
        protect: false,
        logLevel: 'warn',
        message: `Panel content protection off, the panel will appear in recordings (${detail})`
      }
}
