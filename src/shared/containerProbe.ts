export type AudioTrackProbe = 'present' | 'absent' | 'unknown'

function indexOfAscii(bytes: Uint8Array, text: string, from = 0): number {
  const codes = Array.from(text, (char) => char.charCodeAt(0))
  const last = bytes.length - codes.length
  outer: for (let i = from; i <= last; i += 1) {
    for (let j = 0; j < codes.length; j += 1) if (bytes[i + j] !== codes[j]) continue outer
    return i
  }
  return -1
}

function indexOfBytes(bytes: Uint8Array, pattern: number[]): number {
  const last = bytes.length - pattern.length
  outer: for (let i = 0; i <= last; i += 1) {
    for (let j = 0; j < pattern.length; j += 1) if (bytes[i + j] !== pattern[j]) continue outer
    return i
  }
  return -1
}

function probeMp4(bytes: Uint8Array): AudioTrackProbe {
  if (indexOfAscii(bytes, 'mp4a') >= 0 || indexOfAscii(bytes, 'Opus') >= 0) return 'present'
  let handlers = 0
  let from = 0
  for (;;) {
    const at = indexOfAscii(bytes, 'hdlr', from)
    if (at < 0) break
    handlers += 1
    // hdlr payload: version/flags (4), pre_defined (4), handler_type (4)
    const type = String.fromCharCode(...Array.from(bytes.subarray(at + 12, at + 16)))
    if (type === 'soun') return 'present'
    from = at + 4
  }
  // Track headers exist (moov with at least one handler) but none is audio.
  if (handlers > 0 && indexOfAscii(bytes, 'moov') >= 0) return 'absent'
  return 'unknown'
}

function probeWebm(bytes: Uint8Array): AudioTrackProbe {
  if (indexOfAscii(bytes, 'A_OPUS') >= 0 || indexOfAscii(bytes, 'A_VORBIS') >= 0) return 'present'
  // TrackType element (0x83, size 1) with value 2 means audio.
  if (indexOfBytes(bytes, [0x83, 0x81, 0x02]) >= 0) return 'present'
  // Tracks element ID 0x1654AE6B seen, and a video-only codec id inside it.
  if (indexOfBytes(bytes, [0x16, 0x54, 0xae, 0x6b]) >= 0 && indexOfAscii(bytes, 'V_') >= 0) {
    return 'absent'
  }
  return 'unknown'
}

/** Inspects the head of a recorded file or init segment for an audio track. */
export function detectAudioTrack(bytes: Uint8Array, mimeType: string): AudioTrackProbe {
  if (bytes.length === 0) return 'unknown'
  return /webm/i.test(mimeType) ? probeWebm(bytes) : probeMp4(bytes)
}
