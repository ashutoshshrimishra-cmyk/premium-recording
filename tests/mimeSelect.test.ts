import { describe, expect, it } from 'vitest'
import { buildMimeCandidates } from '../src/renderer/src/recorder/mimeSelect'

describe('buildMimeCandidates', () => {
  it('names an audio codec in every candidate when audio is requested', () => {
    const list = buildMimeCandidates(true)
    expect(list[0]).toBe('video/mp4;codecs=avc1.640033,mp4a.40.2')
    for (const mime of list) expect(mime).toMatch(/mp4a\.40\.2|opus/)
    expect(list.some((mime) => mime.includes('aac'))).toBe(false)
  })

  it('returns video-only candidates without audio', () => {
    const list = buildMimeCandidates(false)
    expect(list[0]).toBe('video/mp4;codecs=avc1')
    expect(list.some((mime) => /opus|mp4a|aac/.test(mime))).toBe(false)
  })
})
