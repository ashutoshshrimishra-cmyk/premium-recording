import { describe, it, expect } from 'vitest'
import { sameLayerKey, type LayerKey } from '../src/renderer/src/overlay/layerCache'

const base: LayerKey = {
  version: 3,
  pixelWidth: 1920,
  pixelHeight: 1080,
  ratio: 1,
  draggedId: null
}

describe('sameLayerKey', () => {
  it('is false without a previous key', () => {
    expect(sameLayerKey(null, base)).toBe(false)
  })
  it('is true for identical keys', () => {
    expect(sameLayerKey(base, { ...base })).toBe(true)
  })
  it.each([
    ['version', { version: 4 }],
    ['width', { pixelWidth: 1280 }],
    ['height', { pixelHeight: 720 }],
    ['ratio', { ratio: 1.5 }],
    ['dragged id', { draggedId: 'a1' }]
  ])('invalidates when %s changes', (_name, change) => {
    expect(sameLayerKey(base, { ...base, ...change })).toBe(false)
  })
  it('invalidates when a drag ends', () => {
    expect(sameLayerKey({ ...base, draggedId: 'a1' }, base)).toBe(false)
  })
})
