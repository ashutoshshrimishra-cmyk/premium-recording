import { describe, expect, it } from 'vitest'
import { detectAudioTrack } from '../src/shared/containerProbe'

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0))
const box = (type: string, payload: number[]): number[] => {
  const size = 8 + payload.length
  return [0, 0, (size >> 8) & 255, size & 255, ...ascii(type), ...payload]
}
const hdlr = (handler: string): number[] =>
  box('hdlr', [0, 0, 0, 0, 0, 0, 0, 0, ...ascii(handler), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
const mp4 = (...handlers: string[]): Uint8Array =>
  new Uint8Array([
    ...box('ftyp', ascii('isom')),
    ...box(
      'moov',
      handlers.flatMap((h) => box('trak', box('mdia', hdlr(h))))
    )
  ])

describe('detectAudioTrack', () => {
  const mp4Mime = 'video/mp4;codecs=avc1,mp4a.40.2'
  const webmMime = 'video/webm;codecs=vp9,opus'

  it('finds a soun handler in mp4', () => {
    expect(detectAudioTrack(mp4('vide', 'soun'), mp4Mime)).toBe('present')
  })

  it('reports absent for a video-only mp4 header', () => {
    expect(detectAudioTrack(mp4('vide'), mp4Mime)).toBe('absent')
  })

  it('finds an mp4a sample entry', () => {
    const bytes = new Uint8Array([...box('ftyp', ascii('isom')), ...box('mp4a', [0, 0])])
    expect(detectAudioTrack(bytes, mp4Mime)).toBe('present')
  })

  it('is unknown without track headers', () => {
    expect(detectAudioTrack(new Uint8Array(box('ftyp', ascii('isom'))), mp4Mime)).toBe('unknown')
    expect(detectAudioTrack(new Uint8Array(), mp4Mime)).toBe('unknown')
  })

  it('detects A_OPUS in webm', () => {
    const bytes = new Uint8Array([
      0x1a,
      0x45,
      0xdf,
      0xa3,
      0x16,
      0x54,
      0xae,
      0x6b,
      ...ascii('V_VP9'),
      ...ascii('A_OPUS')
    ])
    expect(detectAudioTrack(bytes, webmMime)).toBe('present')
  })

  it('detects TrackType audio in webm', () => {
    const bytes = new Uint8Array([0x16, 0x54, 0xae, 0x6b, 0x83, 0x81, 0x02])
    expect(detectAudioTrack(bytes, webmMime)).toBe('present')
  })

  it('reports absent for video-only webm and unknown without a Tracks header', () => {
    const videoOnly = new Uint8Array([0x16, 0x54, 0xae, 0x6b, 0x83, 0x81, 0x01, ...ascii('V_VP9')])
    expect(detectAudioTrack(videoOnly, webmMime)).toBe('absent')
    expect(detectAudioTrack(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), webmMime)).toBe('unknown')
  })
})
