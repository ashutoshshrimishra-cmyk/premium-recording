import { describe, expect, it } from 'vitest'
import { createEmptyDiagnostics, formatDiagnostics } from '../src/renderer/src/recorder/diagnostics'

describe('formatDiagnostics', () => {
  it('formats video and audio lines', () => {
    const d = createEmptyDiagnostics({ version: '1.1.0', commit: 'abc1234' })
    d.video = {
      requestedW: 1920,
      requestedH: 1080,
      requestedFps: 30,
      actualW: 1920,
      actualH: 1080,
      actualFps: 29.9,
      bitrate: 8_709_120,
      mime: 'video/mp4;codecs=avc1.640033,mp4a.40.2',
      contentHint: 'detail'
    }
    d.audio.requested = true
    d.audio.deviceLabel = 'Mic A'
    d.audio.context = 'running'
    d.audio.denoised = true
    d.audio.rawLevel = 0.1234
    d.audio.fileHasAudio = 'no'
    const text = formatDiagnostics(d).join('\n')
    expect(text).toContain('v1.1.0 (abc1234)')
    expect(text).toContain('requested 1920x1080 @ 30 fps, got 1920x1080 @ 29.9 fps')
    expect(text).toContain('8.7 Mbps')
    expect(text).toContain('Mic: Mic A')
    expect(text).toContain('raw 0.123')
    expect(text).toContain('Saved file has audio: NO')
  })

  it('omits the saved-file line while pending and handles no audio', () => {
    const d = createEmptyDiagnostics({ version: '1.1.0', commit: 'dev' })
    const lines = formatDiagnostics(d)
    expect(lines).toContain('Audio: not requested')
    expect(lines.join('\n')).not.toContain('Saved file')
  })
})
