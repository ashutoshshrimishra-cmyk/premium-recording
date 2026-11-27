import { describe, it, expect } from 'vitest'
import {
  regionToCapturePixels,
  displayForRegion,
  shouldFallbackDraw,
  CROP_FALLBACK_INTERVAL_MS
} from '../src/renderer/src/recorder/cropMath'

describe('regionToCapturePixels', () => {
  it('scales by DPI at 150%', () => {
    const r = regionToCapturePixels(
      { x: 100, y: 100, width: 400, height: 300 },
      { x: 0, y: 0, width: 1280, height: 720 },
      1.5
    )
    expect(r).toEqual({ x: 150, y: 150, width: 600, height: 450 })
  })

  it('handles a second monitor with a negative origin', () => {
    const r = regionToCapturePixels(
      { x: -1800, y: 50, width: 400, height: 200 },
      { x: -1920, y: 0, width: 1920, height: 1080 },
      1
    )
    expect(r.x).toBe(120)
  })

  it('forces even dimensions', () => {
    const r = regionToCapturePixels(
      { x: 0, y: 0, width: 101, height: 51 },
      { x: 0, y: 0, width: 1920, height: 1080 },
      1
    )
    expect(r.width % 2).toBe(0)
    expect(r.height % 2).toBe(0)
  })

  it('clamps to the display and rejects outside regions', () => {
    const d = { x: 0, y: 0, width: 1000, height: 600 }
    expect(
      regionToCapturePixels({ x: 900, y: 500, width: 500, height: 500 }, d, 1).width
    ).toBeLessThanOrEqual(100)
    expect(() => regionToCapturePixels({ x: 2000, y: 0, width: 10, height: 10 }, d, 1)).toThrow()
  })
})

describe('displayForRegion', () => {
  it('picks the display containing the region centre', () => {
    const ds = [
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }
    ]
    expect(displayForRegion({ x: 2000, y: 100, width: 200, height: 200 }, ds)?.id).toBe(2)
  })
})

describe('shouldFallbackDraw', () => {
  it('draws only after a full idle interval', () => {
    expect(shouldFallbackDraw(1100, 1000, 250)).toBe(false)
    expect(shouldFallbackDraw(1250, 1000, 250)).toBe(true)
    expect(CROP_FALLBACK_INTERVAL_MS).toBe(250)
  })
})
