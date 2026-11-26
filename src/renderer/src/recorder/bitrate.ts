export const MIN_VIDEO_BITRATE = 8_000_000
export const MAX_VIDEO_BITRATE = 80_000_000

/** Video bitrate from frame size, frame rate and codec family (h264 needs more bits than vp8/vp9). */
export function computeBitrate(
  width: number,
  height: number,
  fps: number,
  mimeType: string
): number {
  const isH264 = /mp4|avc1|h264/i.test(mimeType)
  const bitsPerPixel = isH264 ? 0.14 : 0.1
  const raw = width * height * fps * bitsPerPixel
  const safe = Number.isFinite(raw) ? raw : MIN_VIDEO_BITRATE
  return Math.round(Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, safe)))
}
