export interface Point {
  x: number
  y: number
}

import type { OverlayShape, OverlayStamp } from '../../../shared/ipc-schemas'

export type Tool = OverlayShape
export type StampKind = OverlayStamp
export type AnnotationKind = Tool | 'text' | 'stamp'

/** Edge length of a stamp in pixels. */
export const STAMP_SIZE = 56
const TEXT_LINE_HEIGHT = 1.25
const TEXT_CHAR_WIDTH = 0.58

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Annotation {
  id: string
  tool: AnnotationKind
  color: string
  width: number
  /**
   * pen: many points. text: [top-left]. stamp: [center].
   * Other tools: [start, end].
   */
  points: Point[]
  text?: string
  fontSize?: number
  stamp?: StampKind
  /** Measured text width in pixels, when the renderer knows it. */
  textWidth?: number
}

/** Bounding box of a text annotation. Uses the measured width when available. */
export function textBounds(a: Annotation): Rect {
  const fontSize = a.fontSize ?? 28
  const origin = a.points[0] ?? { x: 0, y: 0 }
  const width = a.textWidth ?? (a.text ?? '').length * fontSize * TEXT_CHAR_WIDTH
  return { x: origin.x, y: origin.y, width, height: fontSize * TEXT_LINE_HEIGHT }
}

interface Extent {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

// Annotations are immutable (translateAnnotation returns a new object), so
// the point extent can be cached per object.
const extentCache = new WeakMap<Annotation, Extent>()

function pointExtent(a: Annotation): Extent {
  const cached = extentCache.get(a)
  if (cached) return cached
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of a.points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const extent = { minX, minY, maxX, maxY }
  extentCache.set(a, extent)
  return extent
}

/** Bounding box of any annotation, used for the selection outline. */
export function annotationBounds(a: Annotation): Rect {
  if (a.tool === 'text') return textBounds(a)
  if (a.tool === 'stamp') {
    const c = a.points[0] ?? { x: 0, y: 0 }
    return {
      x: c.x - STAMP_SIZE / 2,
      y: c.y - STAMP_SIZE / 2,
      width: STAMP_SIZE,
      height: STAMP_SIZE
    }
  }
  const e = pointExtent(a)
  const pad = a.width / 2
  const minX = e.minX - pad
  const minY = e.minY - pad
  return {
    x: minX,
    y: minY,
    width: e.maxX + pad - minX,
    height: e.maxY + pad - minY
  }
}

/** Returns a copy moved by (dx, dy). */
export function translateAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  return { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
}

function distToSegmentXY(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

const ELLIPSE_STEPS = 48
// Same expression as the original per-check ring, computed once.
const ELLIPSE_COS: number[] = []
const ELLIPSE_SIN: number[] = []
for (let i = 0; i <= ELLIPSE_STEPS; i++) {
  const t = (i / ELLIPSE_STEPS) * Math.PI * 2
  ELLIPSE_COS.push(Math.cos(t))
  ELLIPSE_SIN.push(Math.sin(t))
}

/** Slack so the bounds pre-check can never reject a hit the exact test accepts. */
const BOUNDS_EPSILON = 1e-6

export function hitTest(a: Annotation, p: Point, radius: number): boolean {
  if (a.tool === 'text') {
    const r = textBounds(a)
    return (
      p.x >= r.x - radius &&
      p.x <= r.x + r.width + radius &&
      p.y >= r.y - radius &&
      p.y <= r.y + r.height + radius
    )
  }
  if (a.tool === 'stamp') {
    const c = a.points[0]
    return Boolean(c) && Math.hypot(p.x - c.x, p.y - c.y) <= STAMP_SIZE / 2 + radius
  }
  const pts = a.points
  if (pts.length === 0) return false
  const reach = radius + a.width / 2
  const slack = reach + BOUNDS_EPSILON
  const e = pointExtent(a)
  if (
    p.x < e.minX - slack ||
    p.x > e.maxX + slack ||
    p.y < e.minY - slack ||
    p.y > e.maxY + slack
  ) {
    return false
  }

  if (a.tool === 'pen') {
    if (pts.length === 1)
      return distToSegmentXY(p.x, p.y, pts[0].x, pts[0].y, pts[0].x, pts[0].y) <= reach
    for (let i = 1; i < pts.length; i++) {
      if (distToSegmentXY(p.x, p.y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= reach) {
        return true
      }
    }
    return false
  }
  if (pts.length < 2) return false
  const [s, en] = pts
  if (a.tool === 'rect' || a.tool === 'roundRect') {
    const l = Math.min(s.x, en.x)
    const t = Math.min(s.y, en.y)
    const r = Math.max(s.x, en.x)
    const b = Math.max(s.y, en.y)
    return (
      distToSegmentXY(p.x, p.y, l, t, r, t) <= reach ||
      distToSegmentXY(p.x, p.y, r, t, r, b) <= reach ||
      distToSegmentXY(p.x, p.y, r, b, l, b) <= reach ||
      distToSegmentXY(p.x, p.y, l, b, l, t) <= reach
    )
  }
  if (a.tool === 'ellipse') {
    const cx = (s.x + en.x) / 2
    const cy = (s.y + en.y) / 2
    const rx = Math.abs(en.x - s.x) / 2
    const ry = Math.abs(en.y - s.y) / 2
    let px = cx + rx * ELLIPSE_COS[0]
    let py = cy + ry * ELLIPSE_SIN[0]
    for (let i = 1; i <= ELLIPSE_STEPS; i++) {
      const nx = cx + rx * ELLIPSE_COS[i]
      const ny = cy + ry * ELLIPSE_SIN[i]
      if (distToSegmentXY(p.x, p.y, px, py, nx, ny) <= reach) return true
      px = nx
      py = ny
    }
    return false
  }
  return distToSegmentXY(p.x, p.y, s.x, s.y, en.x, en.y) <= reach // line / arrows
}

/** Undo steps kept per store. Older steps are dropped (limit: 100 steps). */
export const MAX_HISTORY = 100

/** Annotation list with undo/redo (immutable snapshots). */
export class AnnotationStore {
  private present: Annotation[] = []
  private past: Annotation[][] = []
  private future: Annotation[][] = []
  private counter = 0
  private revision = 0

  /** Increments on every commit, undo and redo. Use it to invalidate caches. */
  get version(): number {
    return this.revision
  }

  get items(): readonly Annotation[] {
    return this.present
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** The topmost annotation near the point, or undefined. */
  topmostAt(p: Point, radius = 8): Annotation | undefined {
    for (let i = this.present.length - 1; i >= 0; i--) {
      if (hitTest(this.present[i], p, radius)) return this.present[i]
    }
    return undefined
  }

  /** Moves an annotation as one undoable step. */
  move(id: string, dx: number, dy: number): boolean {
    if ((dx === 0 && dy === 0) || !this.present.some((a) => a.id === id)) return false
    this.commit(this.present.map((a) => (a.id === id ? translateAnnotation(a, dx, dy) : a)))
    return true
  }

  private commit(next: Annotation[]): void {
    this.past.push(this.present)
    // History is bounded to MAX_HISTORY (100) undo steps; drop the oldest.
    if (this.past.length > MAX_HISTORY) this.past.shift()
    this.present = next
    this.future = []
    this.revision++
  }

  add(input: Omit<Annotation, 'id'>): Annotation {
    const a: Annotation = { ...input, id: `a${++this.counter}` }
    this.commit([...this.present, a])
    return a
  }

  /** Removes the topmost annotation near the point. Returns true if one was removed. */
  eraseAt(p: Point, radius = 8): boolean {
    for (let i = this.present.length - 1; i >= 0; i--) {
      if (hitTest(this.present[i], p, radius)) {
        this.commit(this.present.filter((_, idx) => idx !== i))
        return true
      }
    }
    return false
  }

  remove(id: string): boolean {
    if (!this.present.some((a) => a.id === id)) return false
    this.commit(this.present.filter((a) => a.id !== id))
    return true
  }

  /** Clearing is one undoable step. */
  clear(): void {
    if (this.present.length === 0) return
    this.commit([])
  }

  undo(): boolean {
    const prev = this.past.pop()
    if (!prev) return false
    this.future.push(this.present)
    this.present = prev
    this.revision++
    return true
  }

  redo(): boolean {
    const next = this.future.pop()
    if (!next) return false
    this.past.push(this.present)
    this.present = next
    this.revision++
    return true
  }
}

export interface LaserPoint extends Point {
  t: number
}

/** Laser pointer trail. Time is injected so expiry is testable. */
export class LaserTrail {
  private pts: LaserPoint[] = []
  constructor(private ttlMs = 800) {}

  add(p: Point, now: number): void {
    this.pts.push({ x: p.x, y: p.y, t: now })
  }

  prune(now: number): void {
    this.pts = this.pts.filter((p) => now - p.t < this.ttlMs)
  }

  /** Points with alpha 1 (new) -> 0 (about to expire), for drawing. */
  visible(now: number): (Point & { alpha: number })[] {
    this.prune(now)
    return this.pts.map((p) => ({ x: p.x, y: p.y, alpha: 1 - (now - p.t) / this.ttlMs }))
  }

  get isEmpty(): boolean {
    return this.pts.length === 0
  }
}
