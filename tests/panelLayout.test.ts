import { describe, expect, it } from 'vitest'
import {
  clampToDisplays,
  dockBounds,
  panelSize,
  resizeKeepingEdge,
  resolveDisplay,
  type Rect
} from '../src/main/windows/panelLayout'

const area = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height
})
const displays = [{ id: 11 }, { id: 22 }]

describe('resolveDisplay', () => {
  it('matches the exact display id', () => {
    expect(resolveDisplay('22', 'screen:0:0', displays, displays[0])).toBe(displays[1])
  })

  it('falls back to the screen index for an empty display id', () => {
    expect(resolveDisplay('', 'screen:1:0', displays, displays[0])).toBe(displays[1])
  })

  it('falls back to the primary display for unknown ids', () => {
    expect(resolveDisplay('999', 'window:5:0', displays, displays[1])).toBe(displays[1])
    expect(resolveDisplay('', 'screen:7:0', displays, displays[0])).toBe(displays[0])
  })

  it('uses the first display without a primary and none for no displays', () => {
    expect(resolveDisplay('', '', displays, undefined)).toBe(displays[0])
    expect(resolveDisplay('', '', [], undefined)).toBeUndefined()
  })
})

describe('dockBounds', () => {
  const work = area(0, 0, 1920, 1040)

  it('docks right and centers vertically', () => {
    expect(dockBounds(work, 'right', { width: 84, height: 600 })).toEqual({
      x: 1920 - 84 - 12,
      y: 220,
      width: 84,
      height: 600
    })
  })

  it('docks to the other edges', () => {
    expect(dockBounds(work, 'left', { width: 84, height: 600 }).x).toBe(12)
    expect(dockBounds(work, 'top', { width: 960, height: 132 })).toMatchObject({ x: 480, y: 12 })
    expect(dockBounds(work, 'bottom', { width: 960, height: 132 }).y).toBe(1040 - 132 - 12)
  })

  it('never exceeds a small work area', () => {
    const small = area(100, 50, 300, 200)
    const bounds = dockBounds(small, 'right', { width: 400, height: 500 })
    expect(bounds).toEqual({ x: 100, y: 50, width: 300, height: 200 })
  })
})

describe('clampToDisplays', () => {
  const areas = [area(0, 0, 1920, 1040), area(1920, 0, 1280, 720)]

  it('keeps on-screen bounds unchanged', () => {
    const bounds = area(100, 100, 84, 600)
    expect(clampToDisplays(bounds, areas)).toEqual(bounds)
  })

  it('pulls off-screen bounds back inside the nearest display', () => {
    expect(clampToDisplays(area(5000, -300, 84, 600), areas)).toEqual(area(3116, 0, 84, 600))
    expect(clampToDisplays(area(-500, 900, 84, 600), areas)).toEqual(area(0, 440, 84, 600))
  })

  it('shrinks bounds larger than the display', () => {
    expect(clampToDisplays(area(2000, 0, 2000, 2000), areas)).toEqual(area(1920, 0, 1280, 720))
  })

  it('returns bounds unchanged without displays', () => {
    const bounds = area(1, 2, 3, 4)
    expect(clampToDisplays(bounds, [])).toBe(bounds)
  })
})

describe('panelSize and resizeKeepingEdge', () => {
  it('sizes vertical docks by expansion and caps the height', () => {
    const work = area(0, 0, 1920, 1040)
    expect(panelSize('right', false, work)).toMatchObject({ width: 84, height: 780 })
    expect(panelSize('left', true, work).width).toBe(280)
    expect(panelSize('right', false, area(0, 0, 1366, 700)).height).toBe(676)
    expect(panelSize('top', false, work)).toMatchObject({ width: 960, height: 132 })
  })

  it('keeps the right edge when a right dock expands', () => {
    expect(resizeKeepingEdge(area(1824, 100, 84, 600), 280, 'right')).toEqual(
      area(1628, 100, 280, 600)
    )
    expect(resizeKeepingEdge(area(12, 100, 84, 600), 280, 'left').x).toBe(12)
  })
})
