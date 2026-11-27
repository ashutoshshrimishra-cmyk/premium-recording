import { describe, expect, it } from 'vitest'
import { PROBE_BYTE_LIMIT, probeSlice } from '../src/renderer/src/recorder/probeBytes'

describe('probeSlice', () => {
  it('limits large input to 256 KB with identical leading bytes', async () => {
    const a = new Uint8Array(200 * 1024).fill(1)
    const b = new Uint8Array(200 * 1024).fill(2)
    const out = new Uint8Array(await probeSlice([new Blob([a]), new Blob([b])]).arrayBuffer())
    expect(out.length).toBe(PROBE_BYTE_LIMIT)
    expect(out[0]).toBe(1)
    expect(out[200 * 1024 - 1]).toBe(1)
    expect(out[200 * 1024]).toBe(2)
  })

  it('leaves small input unchanged', async () => {
    const out = new Uint8Array(
      await probeSlice([new Blob([new Uint8Array([1, 2, 3])])]).arrayBuffer()
    )
    expect(Array.from(out)).toEqual([1, 2, 3])
  })
})
