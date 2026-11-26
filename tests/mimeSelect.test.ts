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

import { vi } from 'vitest'
import {
  pickProbeCandidates,
  selectMimeType,
  type ProbeOutcome
} from '../src/renderer/src/recorder/mimeSelect'

const ALL = buildMimeCandidates(true)

describe('selectMimeType', () => {
  const opts = { maxProbes: 3, budgetMs: 8000, now: () => 0 }

  it('caps probes by container family and returns the first candidate with audio', async () => {
    expect(pickProbeCandidates(ALL, 3)).toEqual([
      'video/mp4;codecs=avc1.640033,mp4a.40.2',
      'video/webm;codecs=vp9,opus',
      'video/mp4;codecs=avc1,opus'
    ])
    const probe = vi.fn(async (mime: string): Promise<ProbeOutcome> =>
      mime.includes('webm') ? 'present' : 'absent'
    )
    const result = await selectMimeType(ALL, probe, opts)
    expect(result.mime).toBe('video/webm;codecs=vp9,opus')
    expect(result.audioUnproven).toBe(false)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('never probes more than maxProbes candidates', async () => {
    const probe = vi.fn(async (): Promise<ProbeOutcome> => 'absent')
    const result = await selectMimeType(ALL, probe, opts)
    expect(probe).toHaveBeenCalledTimes(3)
    expect(result.audioUnproven).toBe(true)
    expect(result.mime).toBe(ALL[0])
  })

  it('retries a transient error once on the same candidate', async () => {
    const calls: string[] = []
    const probe = async (mime: string): Promise<ProbeOutcome> => {
      calls.push(mime)
      return calls.length === 1 ? 'error' : 'present'
    }
    const result = await selectMimeType(ALL, probe, opts)
    expect(result.mime).toBe(ALL[0])
    expect(calls).toEqual([ALL[0], ALL[0]])
  })

  it('stops probing when the time budget is spent and prefers an unknown candidate', async () => {
    let clock = 0
    const probe = vi.fn(async (): Promise<ProbeOutcome> => {
      clock += 5000
      return 'unknown'
    })
    const result = await selectMimeType(ALL, probe, {
      maxProbes: 3,
      budgetMs: 8000,
      now: () => clock
    })
    expect(probe).toHaveBeenCalledTimes(2)
    expect(result.mime).toBe(ALL[0])
  })

  it('rejects when nothing is supported', async () => {
    await expect(selectMimeType([], async () => 'present', opts)).rejects.toThrow()
  })
})
