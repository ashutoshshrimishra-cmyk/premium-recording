// Generates build/icon.{png,ico,icns} and resources/icon.png. Run: npm run icons
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeIcns, encodeIco, pngForSize } from './iconRender.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cache = new Map()
const png = (s) => {
  if (!cache.has(s)) cache.set(s, pngForSize(s))
  return cache.get(s)
}
const write = (rel, data) => {
  const p = join(root, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, data)
  console.log(`wrote ${rel} (${data.length} bytes)`)
}

write('build/icon.png', png(1024))
write('resources/icon.png', png(512))
write(
  'build/icon.ico',
  encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) })))
)
write(
  'build/icon.icns',
  encodeIcns([
    { type: 'ic07', png: png(128) },
    { type: 'ic08', png: png(256) },
    { type: 'ic09', png: png(512) },
    { type: 'ic10', png: png(1024) }
  ])
)
