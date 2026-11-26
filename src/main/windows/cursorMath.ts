export interface CursorPoint {
  x: number
  y: number
}

export interface CursorSample extends CursorPoint {
  inside: boolean
}

/** Converts a screen point to display relative DIP coordinates. */
export function toDisplayRelative(
  point: CursorPoint,
  bounds: { x: number; y: number; width: number; height: number }
): CursorSample {
  const x = point.x - bounds.x
  const y = point.y - bounds.y
  return { x, y, inside: x >= 0 && y >= 0 && x < bounds.width && y < bounds.height }
}

export function sameSample(a: CursorSample | undefined, b: CursorSample): boolean {
  return Boolean(a && a.x === b.x && a.y === b.y && a.inside === b.inside)
}

export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

/** True when a screen point lies inside a rectangle (used to ignore clicks on the capture-excluded panel). */
export function isPointInRect(point: CursorPoint, rect: ScreenRect | undefined): boolean {
  if (!rect) return false
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x < rect.x + rect.width &&
    point.y < rect.y + rect.height
  )
}
