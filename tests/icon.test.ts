import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..')
const read = (rel: string): Buffer => readFileSync(join(root, rel))
const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

describe('generated icons', () => {
  it.each([
    ['build/icon.png', 1024],
    ['resources/icon.png', 512]
  ])('%s is a %i px PNG', (rel, size) => {
    const b = read(rel)
    expect([...b.subarray(0, 8)]).toEqual(sig)
    expect(b.readUInt32BE(16)).toBe(size)
    expect(b.readUInt32BE(20)).toBe(size)
  })

  it('icon.ico has an ICONDIR header with sizes up to 256', () => {
    const b = read('build/icon.ico')
    expect(b.readUInt16LE(0)).toBe(0)
    expect(b.readUInt16LE(2)).toBe(1)
    const count = b.readUInt16LE(4)
    expect(count).toBe(7)
    const sizes: number[] = []
    for (let i = 0; i < count; i++) {
      const w = b[6 + i * 16]
      sizes.push(w === 0 ? 256 : w)
      const len = b.readUInt32LE(6 + i * 16 + 8)
      const off = b.readUInt32LE(6 + i * 16 + 12)
      expect([...b.subarray(off, off + 8)]).toEqual(sig)
      expect(off + len).toBeLessThanOrEqual(b.length)
    }
    expect(sizes).toEqual([16, 24, 32, 48, 64, 128, 256])
  })

  it('icon.icns has icns magic and matching length', () => {
    const b = read('build/icon.icns')
    expect(b.subarray(0, 4).toString('ascii')).toBe('icns')
    expect(b.readUInt32BE(4)).toBe(b.length)
  })
})
