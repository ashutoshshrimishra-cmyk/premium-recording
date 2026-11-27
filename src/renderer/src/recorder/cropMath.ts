export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Converts a region in global DIP coordinates (what Electron's screen API uses)
 * into a pixel rect relative to the captured display's own frame.
 * Width/height are forced even because H.264 requires it.
 */
export function regionToCapturePixels(region: Rect, display: Rect, scaleFactor: number): Rect {
  const left = Math.max(region.x, display.x)
  const top = Math.max(region.y, display.y)
  const right = Math.min(region.x + region.width, display.x + display.width)
  const bottom = Math.min(region.y + region.height, display.y + display.height)
  if (right <= left || bottom <= top) throw new Error('Region is outside the display')

  const x = Math.round((left - display.x) * scaleFactor)
  const y = Math.round((top - display.y) * scaleFactor)
  const maxW = Math.round(display.width * scaleFactor)
  const maxH = Math.round(display.height * scaleFactor)
  let width = Math.round((right - left) * scaleFactor)
  let height = Math.round((bottom - top) * scaleFactor)
  width = Math.max(2, Math.min(width, maxW - x) & ~1)
  height = Math.max(2, Math.min(height, maxH - y) & ~1)
  return { x, y, width, height }
}

/** Finds which display holds the centre of the region. */
export function displayForRegion<T extends { bounds: Rect }>(
  region: Rect,
  displays: T[]
): T | undefined {
  const cx = region.x + region.width / 2
  const cy = region.y + region.height / 2
  return displays.find(
    (d) =>
      cx >= d.bounds.x &&
      cx < d.bounds.x + d.bounds.width &&
      cy >= d.bounds.y &&
      cy < d.bounds.y + d.bounds.height
  )
}

/** A region as fractions (0 to 1) of the captured frame, independent of DPI and scaling. */
export type RegionFraction = Rect

/** Clamps a fraction rect into the 0..1 frame. Returns undefined when it is too small to use. */
export function normalizeFraction(region: RegionFraction): RegionFraction | undefined {
  const left = Math.min(1, Math.max(0, Math.min(region.x, region.x + region.width)))
  const right = Math.min(1, Math.max(0, Math.max(region.x, region.x + region.width)))
  const top = Math.min(1, Math.max(0, Math.min(region.y, region.y + region.height)))
  const bottom = Math.min(1, Math.max(0, Math.max(region.y, region.y + region.height)))
  if (right - left < 0.02 || bottom - top < 0.02) return undefined
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Converts a fraction rect into an even-sized pixel crop of a frame of the given size. */
export function fractionToPixels(
  region: RegionFraction,
  frameWidth: number,
  frameHeight: number
): Rect {
  const norm = normalizeFraction(region)
  if (!norm) throw new Error('Region is too small')
  const x = Math.min(Math.round(norm.x * frameWidth), frameWidth - 2) & ~1
  const y = Math.min(Math.round(norm.y * frameHeight), frameHeight - 2) & ~1
  const width = Math.max(2, Math.min(Math.round(norm.width * frameWidth), frameWidth - x) & ~1)
  const height = Math.max(2, Math.min(Math.round(norm.height * frameHeight), frameHeight - y) & ~1)
  return { x, y, width, height }
}

/** How often a static source is redrawn so the canvas output track keeps delivering frames. */
export const CROP_FALLBACK_INTERVAL_MS = 250

/** True when nothing has been drawn for a full fallback interval. */
export function shouldFallbackDraw(now: number, lastDrawAt: number, intervalMs: number): boolean {
  return now - lastDrawAt >= intervalMs
}
