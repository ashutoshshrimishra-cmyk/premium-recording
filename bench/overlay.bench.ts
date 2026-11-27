// Run with: npm run bench:overlay  (not part of npm test)
// Prints mean microseconds per call for the reference (old) and current (new) code.
import { it } from 'vitest'
import {
  AnnotationStore,
  hitTest,
  annotationBounds,
  type Annotation
} from '../src/renderer/src/overlay/annotationModel'
import { oldAnnotationBounds, oldHitTest, oldTopmostAt } from '../tests/helpers/oldHitTest'
import { randomAnnotation, rng } from '../tests/helpers/randomAnnotations'

const rand = rng(42)
const pen: Annotation = {
  id: 'pen',
  tool: 'pen',
  color: '#f00',
  width: 4,
  points: Array.from({ length: 5000 }, (_, i) => ({ x: i * 0.2, y: 500 + Math.sin(i / 50) * 100 }))
}
const ellipse: Annotation = {
  id: 'el',
  tool: 'ellipse',
  color: '#f00',
  width: 4,
  points: [
    { x: 100, y: 100 },
    { x: 700, y: 500 }
  ]
}
const many: Annotation[] = Array.from({ length: 500 }, (_, i) => randomAnnotation(rand, `m${i}`))
const store = new AnnotationStore()
for (const { id: _id, ...rest } of many) {
  void _id
  store.add(rest)
}
const miss = { x: 1500, y: 1500 } // outside everything: typical hover/erase miss
const near = { x: 500, y: 300 }
const ellipses: Annotation[] = Array.from({ length: 2000 }, (_, i) => ({
  ...ellipse,
  id: `e${i}`,
  points: [
    { x: (i % 50) * 20, y: Math.floor(i / 50) * 20 },
    { x: (i % 50) * 20 + 300, y: Math.floor(i / 50) * 20 + 200 }
  ]
}))

/** Mean microseconds per call: warm up, then take the best of 5 timed batches. */
function measure(fn: () => void): number {
  const warm = performance.now()
  let n = 0
  while (performance.now() - warm < 100) {
    fn()
    n++
  }
  const iterations = Math.max(5, n)
  let best = Infinity
  for (let r = 0; r < 5; r++) {
    const t0 = performance.now()
    for (let i = 0; i < iterations; i++) fn()
    best = Math.min(best, ((performance.now() - t0) * 1000) / iterations)
  }
  return best
}

const cases: [string, () => void, () => void][] = [
  [
    'hitTest 5000-pt pen, far miss',
    () => void oldHitTest(pen, miss, 8),
    () => void hitTest(pen, miss, 8)
  ],
  [
    'hitTest 5000-pt pen, inside bounds',
    () => void oldHitTest(pen, { x: 500, y: 560 }, 8),
    () => void hitTest(pen, { x: 500, y: 560 }, 8)
  ],
  [
    'hitTest 2000 ellipses',
    () => {
      for (const e of ellipses) oldHitTest(e, near, 8)
    },
    () => {
      for (const e of ellipses) hitTest(e, near, 8)
    }
  ],
  [
    'topmostAt 500 annotations, miss',
    () => void oldTopmostAt(store.items, miss),
    () => void store.topmostAt(miss)
  ],
  [
    'topmostAt 500 annotations, on canvas',
    () => void oldTopmostAt(store.items, near),
    () => void store.topmostAt(near)
  ],
  [
    'annotationBounds 5000-pt pen',
    () => void oldAnnotationBounds(pen),
    () => void annotationBounds(pen)
  ]
]

it('overlay micro-benchmark', () => {
  const lines = ['case | old us/call | new us/call | speedup']
  for (const [name, oldFn, newFn] of cases) {
    const o = measure(oldFn)
    const n = measure(newFn)
    lines.push(`${name} | ${o.toFixed(2)} | ${n.toFixed(2)} | ${(o / n).toFixed(1)}x`)
  }
  console.log('\n' + lines.join('\n'))
})
