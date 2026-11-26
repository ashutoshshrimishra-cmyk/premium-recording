import { describe, expect, it } from 'vitest'
import { computeBitrate } from '../src/renderer/src/recorder/bitrate'

describe('computeBitrate', () => {
  it('uses 0.14 bpp for h264 and beats the old formula at 1080p30', () => {
    const value = computeBitrate(1920, 1080, 30, 'video/mp4;codecs=avc1.640033,mp4a.40.2')
    expect(value).toBe(Math.round(1920 * 1080 * 30 * 0.14))
    expect(value).toBeGreaterThan(Math.round(1920 * 1080 * 30 * 0.08))
  })

  it('uses 0.10 bpp for webm', () => {
    expect(computeBitrate(2560, 1440, 30, 'video/webm;codecs=vp9,opus')).toBe(
      Math.round(2560 * 1440 * 30 * 0.1)
    )
  })

  it('scales 4K60 h264 below the cap and caps larger frames at 80 Mbps', () => {
    expect(computeBitrate(3840, 2160, 60, 'video/mp4;codecs=avc1')).toBe(
      Math.round(3840 * 2160 * 60 * 0.14)
    )
    expect(computeBitrate(7680, 4320, 60, 'video/mp4;codecs=avc1')).toBe(80_000_000)
  })

  it('floors at 8 Mbps for tiny sizes', () => {
    expect(computeBitrate(320, 240, 15, 'video/webm')).toBe(8_000_000)
  })
})
