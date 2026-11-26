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
  const xs = a.points.map((p) => p.x)
  const ys = a.points.map((p) => p.y)
  const pad = a.width / 2
  const minX = Math.min(...xs) - pad
  const minY = Math.min(...ys) - pad
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) + pad - minX,
    height: Math.max(...ys) + pad - minY
  }
}

/** Returns a copy moved by (dx, dy). */
export function translateAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  return { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function outlineSegments(a: Annotation): [Point, Point][] {
  const pts = a.points
  if (a.tool === 'text' || a.tool === 'stamp') return []
  if (a.tool === 'pen') {
    if (pts.length === 1) return [[pts[0], pts[0]]]
    return pts.slice(1).map((p, i): [Point, Point] => [pts[i], p])
  }
  if (pts.length < 2) return []
  const [s, e] = pts
  if (a.tool === 'rect' || a.tool === 'roundRect') {
    const tl = { x: Math.min(s.x, e.x), y: Math.min(s.y, e.y) }
    const br = { x: Math.max(s.x, e.x), y: Math.max(s.y, e.y) }
    const tr = { x: br.x, y: tl.y }
    const bl = { x: tl.x, y: br.y }
    return [
      [tl, tr],
      [tr, br],
      [br, bl],
      [bl, tl]
    ]
  }
  if (a.tool === 'ellipse') {
    const cx = (s.x + e.x) / 2
    const cy = (s.y + e.y) / 2
    const rx = Math.abs(e.x - s.x) / 2
    const ry = Math.abs(e.y - s.y) / 2
    const n = 48
    const ring: Point[] = []
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2
      ring.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) })
    }
    return ring.slice(1).map((p, i): [Point, Point] => [ring[i], p])
  }
  return [[s, e]] // line / arrows
}

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
  const reach = radius + a.width / 2
  return outlineSegments(a).some(([s, e]) => distToSegment(p, s, e) <= reach)
}

/** Annotation list with undo/redo (immutable snapshots). */
export class AnnotationStore {
  private present: Annotation[] = []
  private past: Annotation[][] = []
  private future: Annotation[][] = []
  private counter = 0

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
    this.present = next
    this.future = []
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
    return true
  }

  redo(): boolean {
    const next = this.future.pop()
    if (!next) return false
    this.past.push(this.present)
    this.present = next
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
