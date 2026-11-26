import { describe, it, expect } from 'vitest'
import {
  AnnotationStore,
  LaserTrail,
  STAMP_SIZE,
  annotationBounds,
  hitTest,
  textBounds,
  translateAnnotation
} from '../src/renderer/src/overlay/annotationModel'

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

describe('text and stamp annotations', () => {
  const text = {
    tool: 'text' as const,
    color: '#fff',
    width: 1,
    fontSize: 20,
    text: 'Hello',
    textWidth: 60,
    points: [{ x: 100, y: 100 }]
  }
  const stamp = {
    tool: 'stamp' as const,
    stamp: 'star' as const,
    color: '#fa0',
    width: 4,
    points: [{ x: 300, y: 300 }]
  }

  it('computes text bounds from the measured width, or an estimate', () => {
    const s = new AnnotationStore()
    const a = s.add(text)
    expect(textBounds(a)).toEqual({ x: 100, y: 100, width: 60, height: 25 })
    const estimated = textBounds({ ...a, textWidth: undefined })
    expect(estimated.width).toBeCloseTo(5 * 20 * 0.58)
  })

  it('hit tests text inside its box and with a radius', () => {
    const a = new AnnotationStore().add(text)
    expect(hitTest(a, { x: 130, y: 110 }, 0)).toBe(true)
    expect(hitTest(a, { x: 130, y: 200 }, 4)).toBe(false)
    expect(hitTest(a, { x: 163, y: 110 }, 4)).toBe(true)
  })

  it('hit tests stamps as a circle around the center', () => {
    const a = new AnnotationStore().add(stamp)
    expect(hitTest(a, { x: 310, y: 310 }, 0)).toBe(true)
    expect(hitTest(a, { x: 300 + STAMP_SIZE, y: 300 }, 0)).toBe(false)
  })

  it('erases text and stamps', () => {
    const s = new AnnotationStore()
    s.add(text)
    s.add(stamp)
    expect(s.eraseAt({ x: 300, y: 300 })).toBe(true)
    expect(s.eraseAt({ x: 110, y: 110 })).toBe(true)
    expect(s.items).toHaveLength(0)
  })

  it('reports annotation bounds', () => {
    const s = new AnnotationStore()
    expect(annotationBounds(s.add(stamp))).toEqual({
      x: 300 - STAMP_SIZE / 2,
      y: 300 - STAMP_SIZE / 2,
      width: STAMP_SIZE,
      height: STAMP_SIZE
    })
    const l = s.add(line)
    expect(annotationBounds(l)).toEqual({ x: -2, y: -2, width: 104, height: 4 })
  })
})

describe('moving annotations', () => {
  it('translates without mutating the original', () => {
    const s = new AnnotationStore()
    const a = s.add(line)
    const moved = translateAnnotation(a, 10, 5)
    expect(moved.points[1]).toEqual({ x: 110, y: 5 })
    expect(a.points[1]).toEqual({ x: 100, y: 0 })
  })

  it('moves as one undoable step', () => {
    const s = new AnnotationStore()
    const a = s.add(line)
    expect(s.move(a.id, 20, 30)).toBe(true)
    expect(s.items[0].points[0]).toEqual({ x: 20, y: 30 })
    s.undo()
    expect(s.items[0].points[0]).toEqual({ x: 0, y: 0 })
    s.redo()
    expect(s.items[0].points[0]).toEqual({ x: 20, y: 30 })
  })

  it('ignores zero moves and unknown ids', () => {
    const s = new AnnotationStore()
    const a = s.add(line)
    expect(s.move(a.id, 0, 0)).toBe(false)
    expect(s.move('missing', 5, 5)).toBe(false)
    expect(s.canUndo).toBe(true)
    s.undo()
    expect(s.canUndo).toBe(false)
    expect(s.canRedo).toBe(true)
  })

  it('finds the topmost annotation at a point', () => {
    const s = new AnnotationStore()
    s.add(line)
    const top = s.add({ ...line, color: '#0f0' })
    expect(s.topmostAt({ x: 50, y: 1 })?.id).toBe(top.id)
    expect(s.topmostAt({ x: 50, y: 80 })).toBeUndefined()
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
