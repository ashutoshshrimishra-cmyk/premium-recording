export interface ProbeResult {
  mime: string
  result: 'present' | 'absent' | 'unknown' | 'unsupported' | 'error'
}

export interface RecordingDiagnostics {
  video: {
    requestedW: number
    requestedH: number
    requestedFps: number
    actualW: number
    actualH: number
    actualFps: number
    bitrate: number
    mime: string
    contentHint: string
  }
  audio: {
    requested: boolean
    deviceLabel: string
    trackState: string
    muted: boolean
    context: string
    denoised: boolean
    bypassed: boolean
    rawLevel: number
    processedLevel: number
    probes: ProbeResult[]
    fileHasAudio: 'yes' | 'no' | 'unknown' | 'pending'
  }
  overlay: { canvas: string; panel: string; error: string }
  build: { version: string; commit: string }
  capture: { windowsBuild: number | null; mode: string }
}

export function createEmptyDiagnostics(build: RecordingDiagnostics['build']): RecordingDiagnostics {
  return {
    video: {
      requestedW: 0,
      requestedH: 0,
      requestedFps: 0,
      actualW: 0,
      actualH: 0,
      actualFps: 0,
      bitrate: 0,
      mime: '',
      contentHint: ''
    },
    audio: {
      requested: false,
      deviceLabel: '',
      trackState: '',
      muted: false,
      context: '',
      denoised: false,
      bypassed: false,
      rawLevel: 0,
      processedLevel: 0,
      probes: [],
      fileHasAudio: 'pending'
    },
    overlay: { canvas: '', panel: '', error: '' },
    build,
    capture: { windowsBuild: null, mode: '' }
  }
}

const yesNo = (value: boolean): string => (value ? 'yes' : 'no')
const level = (value: number): string => value.toFixed(3)

/** Human readable diagnostic lines for the status panel. */
export function formatDiagnostics(d: RecordingDiagnostics): string[] {
  const lines: string[] = []
  const v = d.video
  lines.push(`Build: v${d.build.version} (${d.build.commit})`)
  if (v.requestedW > 0) {
    lines.push(
      `Video: requested ${v.requestedW}x${v.requestedH} @ ${v.requestedFps} fps, got ${v.actualW}x${v.actualH} @ ${v.actualFps.toFixed(1)} fps`
    )
    lines.push(
      `Bitrate: ${(v.bitrate / 1_000_000).toFixed(1)} Mbps, format: ${v.mime || 'n/a'}, hint: ${v.contentHint || 'none'}`
    )
  }
  if (d.capture.mode) {
    lines.push(
      `${d.capture.windowsBuild === null ? 'OS' : `Windows build ${d.capture.windowsBuild}`}, panel capture: ${d.capture.mode}`
    )
  }
  const a = d.audio
  if (!a.requested) {
    lines.push('Audio: not requested')
  } else {
    lines.push(
      `Mic: ${a.deviceLabel || 'unknown device'}, track ${a.trackState || 'n/a'}, muted ${yesNo(a.muted)}`
    )
    lines.push(
      `Audio engine: context ${a.context || 'none'}, AI denoise ${yesNo(a.denoised)}, bypassed ${yesNo(a.bypassed)}`
    )
    lines.push(`Mic level: raw ${level(a.rawLevel)}, processed ${level(a.processedLevel)}`)
    if (a.probes.length > 0) {
      lines.push(`Audio probe: ${a.probes.map((p) => `${p.mime} = ${p.result}`).join('; ')}`)
    }
    if (a.fileHasAudio !== 'pending') {
      lines.push(
        `Saved file has audio: ${a.fileHasAudio === 'yes' ? 'yes' : a.fileHasAudio === 'no' ? 'NO' : 'unknown'}`
      )
    }
  }
  if (d.overlay.canvas || d.overlay.panel || d.overlay.error) {
    lines.push(
      `Overlay: canvas ${d.overlay.canvas || 'n/a'}, panel ${d.overlay.panel || 'n/a'}${d.overlay.error ? `, error ${d.overlay.error}` : ''}`
    )
  }
  return lines
}
