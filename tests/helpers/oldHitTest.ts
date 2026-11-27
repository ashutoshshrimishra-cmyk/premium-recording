// Reference copy of the pre-optimization hit-test (v1.5.0). Used by the
// equivalence test and the benchmark. Do not "improve" this file.
import {
  STAMP_SIZE,
  textBounds,
  type Annotation,
  type Point
} from '../../src/renderer/src/overlay/annotationModel'

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
  return [[s, e]]
}

export function oldHitTest(a: Annotation, p: Point, radius: number): boolean {
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

export function oldTopmostAt(
  items: readonly Annotation[],
  p: Point,
  radius = 8
): Annotation | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    if (oldHitTest(items[i], p, radius)) return items[i]
  }
  return undefined
}

export function oldAnnotationBounds(a: Annotation): {
  x: number
  y: number
  width: number
  height: number
} {
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
