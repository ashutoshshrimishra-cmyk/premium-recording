// Pure icon rasterizer (Node built-ins only). Used by generate-icon.mjs and tests.
import { deflateSync } from 'node:zlib'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const mix = (a, b, t) => a + (b - a) * t

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

// Viewfinder corner bracket for the top-left corner, mirrored by caller. Coordinates in 0..1.
function inBracket(x, y) {
  const lo = 0.17
  const hi = 0.33
  const t = 0.03
  const horiz = y >= lo && y <= lo + t && x >= lo && x <= hi
  const vert = x >= lo && x <= lo + t && y >= lo && y <= hi
  return horiz || vert
}

// Color of one sample in unit square, returns [r,g,b,a] 0..255 (premultiplied-free).
function sample(x, y) {
  const bg = sdRoundRect(x, y, 0.5, 0.5, 0.5, 0.5, 0.22)
  if (bg > 0) return [0, 0, 0, 0]
  // dark vertical gradient background
  let c = [mix(34, 14, y), mix(38, 16, y), mix(52, 24, y)]
  const mx = x > 0.5 ? 1 - x : x
  const my = y > 0.5 ? 1 - y : y
  if (inBracket(mx, my)) c = [226, 232, 240]
  const d = Math.hypot(x - 0.5, y - 0.5)
  // outer ring
  if (d >= 0.255 && d <= 0.3) c = [248, 250, 252]
  // red record dot with soft shading
  if (d < 0.2) {
    const k = clamp(d / 0.2, 0, 1)
    const hl = clamp(1 - Math.hypot(x - 0.44, y - 0.42) / 0.14, 0, 1)
    c = [
      mix(255, 200, k * k) + hl * 40,
      mix(82, 22, k * k) + hl * 70,
      mix(82, 36, k * k) + hl * 70
    ].map((v) => clamp(v, 0, 255))
  }
  return [c[0], c[1], c[2], 255]
}

export function renderIcon(size) {
  const ss = size >= 128 ? 3 : 4
  const out = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const s = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)
          r += s[0] * s[3]
          g += s[1] * s[3]
          b += s[2] * s[3]
          a += s[3]
        }
      }
      const o = (py * size + px) * 4
      if (a > 0) {
        out[o] = Math.round(r / a)
        out[o + 1] = Math.round(g / a)
        out[o + 2] = Math.round(b / a)
        out[o + 3] = Math.round(a / (ss * ss))
      }
    }
  }
  return out
}

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

export function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

export function pngForSize(size) {
  return encodePng(size, renderIcon(size))
}

export function encodeIco(entries) {
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(entries.length, 4)
  let offset = 6 + entries.length * 16
  const dir = []
  for (const { size, png } of entries) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += png.length
    dir.push(e)
  }
  return Buffer.concat([head, ...dir, ...entries.map((e) => e.png)])
}

export function encodeIcns(items) {
  const body = items.map(({ type, png }) => {
    const h = Buffer.alloc(8)
    h.write(type, 0, 'ascii')
    h.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([h, png])
  })
  const total = 8 + body.reduce((n, b) => n + b.length, 0)
  const h = Buffer.alloc(8)
  h.write('icns', 0, 'ascii')
  h.writeUInt32BE(total, 4)
  return Buffer.concat([h, ...body])
}
