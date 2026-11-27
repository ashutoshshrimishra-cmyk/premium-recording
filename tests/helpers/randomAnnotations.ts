import type { Annotation } from '../../src/renderer/src/overlay/annotationModel'

/** Deterministic PRNG (mulberry32) so tests and benchmarks are repeatable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TOOLS = ['pen', 'rect', 'roundRect', 'ellipse', 'line', 'arrow', 'doubleArrow'] as const

export function randomAnnotation(rand: () => number, id: string, size = 1000): Annotation {
  const tool = TOOLS[Math.floor(rand() * TOOLS.length)]
  const pt = (): { x: number; y: number } => ({ x: rand() * size, y: rand() * size })
  const count = tool === 'pen' ? 1 + Math.floor(rand() * 60) : 2
  return {
    id,
    tool,
    color: '#f00',
    width: 1 + Math.floor(rand() * 12),
    points: Array.from({ length: count }, pt)
  }
}
