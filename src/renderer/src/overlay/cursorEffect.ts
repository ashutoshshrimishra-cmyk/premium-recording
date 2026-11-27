/** Pure logic for the cursor halo, click ripples and pointer. No DOM use. */

export interface CursorEffectSettings {
  highlight: boolean
  ripple: boolean
  drawPointer: boolean
  highlightColor: string
  /** Halo radius in DIP. */
  radius: number
}

export const defaultCursorEffect: CursorEffectSettings = {
  highlight: true,
  ripple: true,
  drawPointer: false,
  highlightColor: 'rgba(255, 214, 10, 0.35)',
  radius: 28
}

export const RIPPLE_DURATION_MS = 600

export interface Ripple {
  x: number
  y: number
  startedAt: number
}

export interface RippleState {
  ripples: Ripple[]
}

export interface ActiveRipple {
  x: number
  y: number
  /** 0 at the start, 1 at the end. */
  progress: number
}

export function createRippleState(): RippleState {
  return { ripples: [] }
}

export const RIPPLE_DEDUPE_MS = 250
export const RIPPLE_DEDUPE_PX = 16

/**
 * Adds a click ripple unless an equivalent one just started at the same place. The DOM fallback and the
 * global mouse hook can both report the same click. Returns whether a ripple was added.
 */
export function addRipple(state: RippleState, x: number, y: number, now: number): boolean {
  const duplicate = state.ripples.some(
    (ripple) =>
      now - ripple.startedAt < RIPPLE_DEDUPE_MS &&
      Math.hypot(ripple.x - x, ripple.y - y) <= RIPPLE_DEDUPE_PX
  )
  if (duplicate) return false
  state.ripples.push({ x, y, startedAt: now })
  return true
}

/** Drops expired ripples and returns the live ones with their progress. */
export function stepRipples(state: RippleState, now: number): ActiveRipple[] {
  state.ripples = state.ripples.filter((ripple) => now - ripple.startedAt < RIPPLE_DURATION_MS)
  return state.ripples.map((ripple) => ({
    x: ripple.x,
    y: ripple.y,
    progress: Math.min(1, Math.max(0, (now - ripple.startedAt) / RIPPLE_DURATION_MS))
  }))
}

export interface Position {
  x: number
  y: number
}

/** Exponential smoothing step. alpha 1 jumps to the target, 0 stays. */
export function smoothPosition(
  prev: Position | undefined,
  next: Position,
  alpha: number
): Position {
  if (!prev) return { x: next.x, y: next.y }
  const a = Math.min(1, Math.max(0, alpha))
  return { x: prev.x + (next.x - prev.x) * a, y: prev.y + (next.y - prev.y) * a }
}

export const SMOOTHING_ALPHA = 0.5
const CONVERGED_DISTANCE = 0.5

export function hasConverged(a: Position, b: Position): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < CONVERGED_DISTANCE
}

/** True when the cursor layer has anything to draw. With every effect off it stays idle. */
export function cursorEffectsActive(settings: CursorEffectSettings): boolean {
  return settings.highlight || settings.ripple || settings.drawPointer
}
