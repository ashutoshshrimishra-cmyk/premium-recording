/**
 * MediaRecorder MIME candidates, best first. When audio is requested every candidate names an audio codec
 * explicitly, because an unspecified codec lets some Windows installs silently drop the audio track.
 */
export function buildMimeCandidates(hasAudio: boolean): string[] {
  if (hasAudio) {
    return [
      'video/mp4;codecs=avc1.640033,mp4a.40.2',
      'video/mp4;codecs=avc1.64002A,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/mp4;codecs=avc1,opus',
      'video/webm;codecs=h264,opus'
    ]
  }
  return ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
}

export type ProbeOutcome = 'present' | 'absent' | 'unknown' | 'error'

export interface SelectOptions {
  /** Most candidates that may be probed. */
  maxProbes: number
  /** Probing stops once this much time has been spent. */
  budgetMs: number
  now: () => number
}

export interface SelectResult {
  mime: string
  probes: Array<{ mime: string; result: ProbeOutcome }>
  /** True when no candidate was proven to carry audio. */
  audioUnproven: boolean
}

export const DEFAULT_MAX_PROBES = 3
export const DEFAULT_PROBE_BUDGET_MS = 8000

/** Keeps one candidate per container family and codec pair, in order, so probes are not wasted on near duplicates. */
export function pickProbeCandidates(supported: string[], maxProbes: number): string[] {
  const seen = new Set<string>()
  const picked: string[] = []
  for (const mime of supported) {
    const family = `${mime.startsWith('video/mp4') ? 'mp4' : 'webm'}-${/opus/.test(mime) ? 'opus' : 'aac'}`
    if (seen.has(family)) continue
    seen.add(family)
    picked.push(mime)
    if (picked.length >= maxProbes) break
  }
  return picked
}

/**
 * Chooses the first supported candidate whose probe recording carries audio. `probe` records a short clip
 * with one candidate. A transient `error` on a candidate is retried once. Total probing is bounded by
 * `maxProbes` and `budgetMs`.
 */
export async function selectMimeType(
  supported: string[],
  probe: (mime: string) => Promise<ProbeOutcome>,
  options: SelectOptions
): Promise<SelectResult> {
  if (supported.length === 0)
    throw new Error('This system has no supported screen recording format')
  const candidates = pickProbeCandidates(supported, options.maxProbes)
  const probes: SelectResult['probes'] = []
  const startedAt = options.now()
  let firstUnknown: string | undefined
  for (const mime of candidates) {
    if (probes.length > 0 && options.now() - startedAt >= options.budgetMs) break
    let result = await probe(mime)
    if (result === 'error' && options.now() - startedAt < options.budgetMs)
      result = await probe(mime)
    probes.push({ mime, result })
    if (result === 'present') return { mime, probes, audioUnproven: false }
    if (result === 'unknown') firstUnknown ??= mime
  }
  return { mime: firstUnknown ?? supported[0], probes, audioUnproven: true }
}
