import { describe, it, expect } from 'vitest'
import { AnnotationStore, LaserTrail } from '../src/renderer/src/overlay/annotationModel'

const line = { tool: 'line' as const, color: '#f00', width: 4, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }

describe('AnnotationStore', () => {
  it('adds, undoes and redoes', () => {
    const s = new AnnotationStore()
    s.add(line)
    expect(s.items).toHaveLength(1)
    s.undo()
    expect(s.items).toHaveLength(0)
    s.redo()
    expect(s.items).toHaveLength(1)
  })

  it('erases only the stroke under the cursor', () => {
    const s = new AnnotationStore()
    s.add(line)
    s.add({ ...line, points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] })
    expect(s.eraseAt({ x: 50, y: 2 })).toBe(true)
    expect(s.items).toHaveLength(1)
    expect(s.eraseAt({ x: 500, y: 500 })).toBe(false)
  })

  it('a new action clears redo history', () => {
    const s = new AnnotationStore()
    s.add(line)
    s.undo()
    s.add(line)
    expect(s.redo()).toBe(false)
  })

  it('clear is undoable', () => {
    const s = new AnnotationStore()
    s.add(line)
    s.clear()
    expect(s.items).toHaveLength(0)
    s.undo()
    expect(s.items).toHaveLength(1)
  })
})

describe('LaserTrail', () => {
  it('fades and expires after the TTL', () => {
    const l = new LaserTrail(800)
    l.add({ x: 1, y: 1 }, 0)
    expect(l.visible(400)[0].alpha).toBeCloseTo(0.5)
    expect(l.visible(800)).toHaveLength(0)
    expect(l.isEmpty).toBe(true)
  })
})
