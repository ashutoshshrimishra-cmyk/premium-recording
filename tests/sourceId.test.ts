import { describe, it, expect } from 'vitest'
import { displayLabel, matchDisplay, parseSourceId, sortDisplays } from '../src/shared/sourceId'
import { fractionToPixels, normalizeFraction } from '../src/renderer/src/recorder/cropMath'
import {
  getSourcesInputSchema,
  recordingSelectSourceInputSchema,
  recordingStartInputSchema
} from '../src/shared/ipc-schemas'

const displays = [
  { id: 11, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
  { id: 22, bounds: { x: 1920, y: 0, width: 1280, height: 720 }, scaleFactor: 1 },
  { id: 33, bounds: { x: -1280, y: 0, width: 1280, height: 720 }, scaleFactor: 1 }
]

describe('parseSourceId', () => {
  it('parses screen and window ids', () => {
    expect(parseSourceId('screen:1:0')).toEqual({ kind: 'screen', index: 1 })
    expect(parseSourceId('window:4521:0')).toEqual({ kind: 'window', index: 4521 })
  })
  it('rejects other strings', () => {
    expect(parseSourceId('file:///etc/passwd')).toBeUndefined()
    expect(parseSourceId('screen:x')).toBeUndefined()
  })
})

describe('matchDisplay and sortDisplays', () => {
  it('matches by display_id first', () => {
    expect(matchDisplay('22', 'screen:0:0', displays)?.id).toBe(22)
  })
  it('falls back to the source index and ignores windows', () => {
    expect(matchDisplay('', 'screen:2:0', displays)?.id).toBe(33)
    expect(matchDisplay('', 'window:5:0', displays)).toBeUndefined()
  })
  it('puts the primary first, then left to right', () => {
    expect(sortDisplays(displays, 22).map((d) => d.id)).toEqual([22, 33, 11])
  })
  it('labels monitors', () => {
    expect(displayLabel(2, 1920, 1080, false)).toBe('Display 2 (1920x1080)')
    expect(displayLabel(1, 2560, 1440, true)).toBe('Display 1 (2560x1440) - Primary')
  })
})

describe('schemas', () => {
  it('accepts window ids and rejects arbitrary strings', () => {
    expect(recordingSelectSourceInputSchema.safeParse({ sourceId: 'window:12:0' }).success).toBe(
      true
    )
    expect(recordingSelectSourceInputSchema.safeParse({ sourceId: 'file:x' }).success).toBe(false)
    expect(
      recordingStartInputSchema.safeParse({
        sourceId: 'window:12:0',
        mimeType: 'video/webm',
        fps: 30,
        width: 1920,
        height: 1080,
        saveDir: 'C:/v'
      }).success
    ).toBe(true)
    expect(getSourcesInputSchema.safeParse({ kind: 'window' }).success).toBe(true)
    expect(getSourcesInputSchema.safeParse({ kind: 'other' }).success).toBe(false)
  })
})

describe('region fractions', () => {
  it('normalizes a reversed drag and rejects tiny regions', () => {
    const r = normalizeFraction({ x: 0.6, y: 0.5, width: -0.4, height: 0.3 })
    expect(r?.x).toBeCloseTo(0.2)
    expect(r?.y).toBeCloseTo(0.5)
    expect(r?.width).toBeCloseTo(0.4)
    expect(r?.height).toBeCloseTo(0.3)
    expect(normalizeFraction({ x: 0.1, y: 0.1, width: 0.005, height: 0.5 })).toBeUndefined()
  })
  it('converts to even pixels inside the frame', () => {
    const r = fractionToPixels({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 }, 1920, 1080)
    expect(r).toEqual({ x: 960, y: 540, width: 960, height: 540 })
    const edge = fractionToPixels({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, 1001, 1001)
    expect(edge.x % 2).toBe(0)
    expect(edge.x + edge.width).toBeLessThanOrEqual(1001)
    expect(edge.y + edge.height).toBeLessThanOrEqual(1001)
  })
})
