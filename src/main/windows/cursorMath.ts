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

/** Poll interval while the pointer moves (about one frame at 60 Hz). */
export const CURSOR_POLL_MS = 16
/** Poll interval once the pointer has rested for CURSOR_IDLE_AFTER_MS. */
export const CURSOR_IDLE_POLL_MS = 50
export const CURSOR_IDLE_AFTER_MS = 500

/**
 * Delay until the next pointer poll. Polling slows down while the pointer rests and returns to
 * the fast rate on the first movement, so the halo stays smooth while moving.
 */
export function nextCursorPollDelay(idleForMs: number): number {
  return idleForMs >= CURSOR_IDLE_AFTER_MS ? CURSOR_IDLE_POLL_MS : CURSOR_POLL_MS
}

export type DisplayChangeAction = 'ignore' | 'resize' | 'close-canvas'

/** What the overlay does when a display changes or is removed while it is open. */
export function displayChangeAction(
  overlayDisplayId: number | undefined,
  changedDisplayId: number,
  change: 'metrics' | 'removed'
): DisplayChangeAction {
  if (overlayDisplayId === undefined || overlayDisplayId !== changedDisplayId) return 'ignore'
  return change === 'removed' ? 'close-canvas' : 'resize'
}
