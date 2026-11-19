import { describe, expect, it } from 'vitest'
import { generateRecordingFilename, hasEnoughDiskSpace } from '../src/main/recording'

describe('recording helpers', () => {
  it('generates timestamped mp4 and webm filenames', () => {
    const date = new Date(2026, 10, 19, 9, 8, 7)
    expect(generateRecordingFilename(date, 'video/mp4')).toBe('Recording_2026-11-19_09-08-07.mp4')
    expect(generateRecordingFilename(date, 'video/webm;codecs=vp9')).toBe(
      'Recording_2026-11-19_09-08-07.webm'
    )
  })

  it('checks the minimum writable disk capacity', () => {
    expect(hasEnoughDiskSpace(101 * 1024 * 1024)).toBe(true)
    expect(hasEnoughDiskSpace(99 * 1024 * 1024)).toBe(false)
  })
})
