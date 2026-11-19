export interface Rect { x: number; y: number; width: number; height: number }

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
export function displayForRegion<T extends { bounds: Rect }>(region: Rect, displays: T[]): T | undefined {
  const cx = region.x + region.width / 2
  const cy = region.y + region.height / 2
  return displays.find(
    (d) => cx >= d.bounds.x && cx < d.bounds.x + d.bounds.width && cy >= d.bounds.y && cy < d.bounds.y + d.bounds.height
  )
}
