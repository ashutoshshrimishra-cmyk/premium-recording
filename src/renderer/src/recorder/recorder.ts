import { RecordingChunkWriter } from './chunkWriter'
import { openMicrophone, type MicrophoneChain } from './microphone'
import {
  closeRecordingFile,
  openMicrophoneWithFallback,
  type MicChoice,
  type MicFailure
} from './micFallback'
import {
  DEFAULT_MAX_PROBES,
  DEFAULT_PROBE_BUDGET_MS,
  buildMimeCandidates,
  selectMimeType,
  type ProbeOutcome
} from './mimeSelect'
import { computeBitrate } from './bitrate'
import { fractionToPixels, type RegionFraction } from './cropMath'
import { sourceKindOf } from '../../../shared/sourceId'
import { detectAudioTrack } from '../../../shared/containerProbe'
import { createEmptyDiagnostics, type RecordingDiagnostics } from './diagnostics'

export interface RecorderCallbacks {
  onStatus: (status: 'starting' | 'recording' | 'paused' | 'stopping') => void
  onError: (message: string) => void
  onWarning?: (message: string) => void
  onMimeType: (mimeType: string) => void
  onRealFps: (fps: number) => void
  onFile: (filePath: string) => void
  onStopped: () => void
  onDiagnostics?: (diagnostics: RecordingDiagnostics) => void
}

interface VideoFrameCallbackVideo extends HTMLVideoElement {
  requestVideoFrameCallback(
    callback: (now: number, metadata: VideoFrameCallbackMetadata) => void
  ): number
}

const PROBE_DURATION_MS = 800
const DIAGNOSTICS_INTERVAL_MS = 500
const MIC_STATE_INTERVAL_MS = 100

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class ScreenRecorder {
  private stream?: MediaStream
  private mediaRecorder?: MediaRecorder
  private measurementVideo?: HTMLVideoElement
  private stopped = false
  private finishing = false
  private recorderStarted = false
  private fileStarted = false
  private finishFallback?: ReturnType<typeof setTimeout>
  private frameTimes: number[] = []
  private chunkWriter?: RecordingChunkWriter
  private sessionId?: string
  private removeStopListener?: () => void
  private microphone?: MicrophoneChain
  private diagnostics: RecordingDiagnostics = createEmptyDiagnostics({
    version: __APP_VERSION__,
    commit: __BUILD_COMMIT__
  })
  private diagnosticsTimer?: ReturnType<typeof setInterval>
  private lastRealFps = 0
  private micMuted = false
  private denoiseActive = true
  private removeMicListener?: () => void
  private micStateTimer?: ReturnType<typeof setInterval>
  private cropTimer?: ReturnType<typeof setInterval>
  private cropVideo?: HTMLVideoElement
  private cropSource?: MediaStream

  constructor(private callbacks: RecorderCallbacks) {}

  async start(options: {
    sourceId: string
    fps: number
    width: number
    height: number
    saveDir: string
    audioDeviceId: string
    noiseSuppression: boolean
    region?: RegionFraction
    onMicFailure?: (failure: MicFailure) => Promise<MicChoice>
  }): Promise<void> {
    this.stopped = false
    this.finishing = false
    this.recorderStarted = false
    this.fileStarted = false
    this.sessionId = undefined
    this.lastRealFps = 0
    this.diagnostics = createEmptyDiagnostics({
      version: __APP_VERSION__,
      commit: __BUILD_COMMIT__
    })
    this.diagnostics.video.requestedW = options.width
    this.diagnostics.video.requestedH = options.height
    this.diagnostics.video.requestedFps = options.fps
    this.diagnostics.audio.requested = options.audioDeviceId !== 'none'
    try {
      const info = await window.api.diagnosticsGetInfo()
      this.diagnostics.capture = { windowsBuild: info.windowsBuild, mode: info.captureMode }
    } catch {
      // Diagnostics only, recording continues without the capture mode.
    }
    this.callbacks.onStatus('starting')
    this.log(
      `Recording requested: v${__APP_VERSION__} (${__BUILD_COMMIT__}) ${options.width}x${options.height}@${options.fps} audio=${options.audioDeviceId} denoise=${options.noiseSuppression}`
    )

    await window.api.recordingSelectSource({ sourceId: options.sourceId })
    let displayStream: MediaStream
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: options.fps, max: options.fps },
          width: { ideal: options.width },
          height: { ideal: options.height },
          cursor: 'always'
        },
        audio: false
      } as MediaStreamConstraints)
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        name === 'NotAllowedError'
          ? `Screen permission was denied (${detail})`
          : `Could not capture the screen: ${name} ${detail}`.trim(),
        { cause: error }
      )
    }

    if (options.region) {
      try {
        displayStream = await this.cropDisplayStream(displayStream, options.region, options.fps)
      } catch (error) {
        displayStream.getTracks().forEach((track) => track.stop())
        this.disposeCrop()
        throw error
      }
    }

    this.stream = displayStream
    if (this.stopped) {
      this.stopTracks()
      throw new Error('Recording was cancelled')
    }

    let microphone: MicrophoneChain | undefined
    if (options.audioDeviceId !== 'none') {
      const open = (): Promise<MicrophoneChain> =>
        openMicrophone({
          deviceId: options.audioDeviceId,
          noiseSuppression: options.noiseSuppression
        })
      let videoOnlyReason = ''
      try {
        if (options.onMicFailure) {
          const ask = options.onMicFailure
          const result = await openMicrophoneWithFallback(
            open,
            (failure) => {
              videoOnlyReason = failure.message
              return ask(failure)
            },
            () => this.stopped
          )
          microphone = result.microphone
          if (result.videoOnly) {
            this.diagnostics.audio.requested = false
            this.warn(`Recording without audio: ${videoOnlyReason}`)
          }
        } else {
          microphone = await open()
        }
      } catch (error) {
        displayStream.getTracks().forEach((track) => track.stop())
        this.cleanup()
        if (error instanceof Error && error.message === 'Recording was cancelled') throw error
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`Could not use the selected microphone: ${detail}`, { cause: error })
      }
    }
    this.microphone = microphone

    if (this.stopped) {
      displayStream.getTracks().forEach((track) => track.stop())
      microphone?.dispose()
      this.microphone = undefined
      throw new Error('Recording was cancelled')
    }

    const stream = new MediaStream([
      ...displayStream.getVideoTracks(),
      ...(microphone ? [microphone.track] : [])
    ])
    this.stream = stream
    if (this.diagnostics.audio.requested && stream.getAudioTracks().length === 0) {
      this.stopTracks()
      this.cleanup()
      throw new Error(
        'No microphone audio was captured. Check the microphone selection and permission.'
      )
    }
    if (microphone?.warning) this.warn(microphone.warning)
    if (microphone) {
      microphone.onBypass = (): void => {
        this.warn('Noise removal produced no sound, so the raw microphone signal is used instead.')
        this.log('Audio failsafe: switched to the raw microphone signal')
      }
      microphone.track.onended = (): void => {
        if (!this.stopped)
          this.callbacks.onWarning?.('The microphone was disconnected. Audio may be missing.')
      }
    }
    if (this.stopped) {
      this.stopTracks()
      throw new Error('Recording was cancelled')
    }

    const videoTrack = stream.getVideoTracks()[0]
    if (!videoTrack) {
      this.stopTracks()
      throw new Error('No video track was returned by the screen capture')
    }

    const settings = videoTrack.getSettings()
    const width = settings.width ?? options.width
    const height = settings.height ?? options.height
    const fps = settings.frameRate ?? options.fps
    videoTrack.contentHint = 'detail'
    const hasAudio = stream.getAudioTracks().length > 0
    let recorder: MediaRecorder
    let bitrate: number
    try {
      const mime = await this.chooseMimeType(stream, hasAudio)
      bitrate = computeBitrate(width, height, fps, mime)
      recorder = this.createMediaRecorder(stream, mime, bitrate, hasAudio)
    } catch (error) {
      this.stopTracks()
      this.cleanup()
      throw error
    }
    const mimeType = recorder.mimeType
    this.diagnostics.video = {
      ...this.diagnostics.video,
      actualW: width,
      actualH: height,
      actualFps: fps,
      bitrate,
      mime: mimeType,
      contentHint: videoTrack.contentHint
    }
    const fullScreen = !options.region && sourceKindOf(options.sourceId) === 'screen'
    if (fullScreen && (width < options.width || height < options.height)) {
      this.warn(
        `The screen delivered ${width}x${height}, below the requested ${options.width}x${options.height}.`
      )
    }
    this.log(`Recorder created: ${mimeType} ${width}x${height}@${fps} ${bitrate} bps`)
    this.mediaRecorder = recorder
    this.callbacks.onMimeType(mimeType)
    this.removeStopListener = window.api.onRecordingStopRequested(() => void this.stop())

    try {
      const started = await window.api.recordingStart({
        sourceId: options.sourceId,
        mimeType,
        fps: options.fps,
        width: options.width,
        height: options.height,
        saveDir: options.saveDir
      })
      this.fileStarted = true
      this.sessionId = started.sessionId
      this.applyOverlayStatus(started.overlay)
      if (this.stopped) throw new Error('Recording was cancelled')

      this.chunkWriter = new RecordingChunkWriter(
        (data) => window.api.recordingChunk({ sessionId: started.sessionId, data }),
        (error) => {
          this.callbacks.onError(`Chunk write failed: ${error.message}`)
          void this.stop()
        }
      )

      recorder.ondataavailable = (event): void => this.chunkWriter?.enqueue(event.data)
      recorder.onerror = (event): void => {
        this.callbacks.onError(
          `MediaRecorder error: ${String(event.error?.message || 'unknown error')}`
        )
        void this.stop()
      }
      recorder.onstop = (): void => void this.finishStop(mimeType)
      recorder.onpause = (): void => this.callbacks.onStatus('paused')
      recorder.onresume = (): void => this.callbacks.onStatus('recording')
      videoTrack.onended = (): void => {
        if (!this.stopped) {
          this.callbacks.onError('Screen capture stream ended')
          void this.stop()
        }
      }

      const video = document.createElement('video')
      this.measurementVideo = video
      video.muted = true
      video.srcObject = stream
      void video
        .play()
        .then(() => this.measureFrames(video as VideoFrameCallbackVideo))
        .catch(() => undefined)

      recorder.start(1000)
      this.recorderStarted = true
      try {
        await videoTrack.applyConstraints({ frameRate: options.fps })
      } catch {
        // Some capture sources reject frame rate changes after start.
      }
      this.startDiagnostics()
      this.startMicBridge()
      this.callbacks.onStatus('recording')
    } catch (error) {
      this.stopTracks()
      if (this.fileStarted && this.sessionId) {
        await window.api
          .recordingStop({ sessionId: this.sessionId, mimeType, discard: true })
          .catch(() => undefined)
      }
      this.cleanup()
      throw error instanceof Error ? error : new Error('Could not start recording')
    }
  }

  pause(): void {
    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.pause()
  }

  resume(): void {
    if (this.mediaRecorder?.state === 'paused') this.mediaRecorder.resume()
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.callbacks.onStatus('stopping')
    if (this.mediaRecorder) {
      if (this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop()
        return
      }
      if (this.recorderStarted) {
        this.finishFallback ??= setTimeout(
          () => void this.finishStop(this.mediaRecorder?.mimeType || 'video/webm'),
          1000
        )
        return
      }
    }
    await this.finishStop(this.mediaRecorder?.mimeType || 'video/webm')
  }

  private log(line: string): void {
    void window.api.diagnosticsLog(line.slice(0, 1900)).catch(() => undefined)
  }

  private warn(message: string): void {
    this.log(`WARNING: ${message}`)
    this.callbacks.onWarning?.(message)
  }

  private emitDiagnostics(): void {
    const d = this.diagnostics
    const mic = this.microphone
    if (mic) {
      const levels = mic.getLevels()
      d.audio.rawLevel = levels.raw
      d.audio.processedLevel = levels.processed
      d.audio.context = mic.contextState
      d.audio.denoised = mic.denoised
      d.audio.bypassed = mic.isBypassed()
      d.audio.deviceLabel = mic.deviceLabel
      d.audio.trackState = mic.track.readyState
      d.audio.muted = this.micMuted || !mic.track.enabled || mic.track.muted
    }
    d.video.actualFps = this.lastRealFps || d.video.actualFps
    this.callbacks.onDiagnostics?.({
      ...d,
      video: { ...d.video },
      audio: { ...d.audio },
      capture: { ...d.capture }
    })
  }

  private applyOverlayStatus(overlay: { canvas: boolean; toolbar: boolean; error?: string }): void {
    this.diagnostics.overlay = {
      canvas: overlay.canvas ? 'ok' : 'failed',
      panel: overlay.toolbar ? 'ok' : 'failed',
      error: overlay.error ?? ''
    }
    this.log(`Overlay: canvas ${overlay.canvas}, panel ${overlay.toolbar} ${overlay.error ?? ''}`)
    if (!overlay.toolbar) {
      this.warn(
        `The annotation panel could not be shown (${overlay.error || 'unknown reason'}). Use Stop in this window to finish the recording.`
      )
    }
  }

  /** Lets the annotation panel mute the microphone and toggle AI noise removal, and feeds it the level. */
  private startMicBridge(): void {
    const mic = this.microphone
    if (!mic) return
    this.removeMicListener = window.api.onRecordingMicCommand((command) => {
      if (command.type === 'mute') {
        this.micMuted = command.muted
        mic.setMuted(command.muted)
      } else {
        this.denoiseActive = command.active
        mic.setProcessedActive(command.active)
      }
      this.log(`Mic command: ${JSON.stringify(command)}`)
      this.publishMicState()
    })
    this.publishMicState()
    this.micStateTimer = setInterval(() => this.publishMicState(), MIC_STATE_INTERVAL_MS)
  }

  private publishMicState(): void {
    const mic = this.microphone
    if (!mic) return
    const levels = mic.getLevels()
    const level = this.micMuted ? 0 : Math.min(1, Math.max(levels.raw, levels.processed) * 2)
    void window.api
      .recordingPublishMicState({
        muted: this.micMuted,
        level,
        denoised: mic.denoised && this.denoiseActive && !mic.isBypassed(),
        bypassed: mic.isBypassed(),
        available: mic.denoised
      })
      .catch(() => undefined)
  }

  private startDiagnostics(): void {
    this.emitDiagnostics()
    this.diagnosticsTimer = setInterval(() => this.emitDiagnostics(), DIAGNOSTICS_INTERVAL_MS)
  }

  /** Records a short clip with each candidate and keeps the first one whose output really carries audio. */
  private async chooseMimeType(stream: MediaStream, hasAudio: boolean): Promise<string> {
    const supported = buildMimeCandidates(hasAudio).filter((mime) =>
      MediaRecorder.isTypeSupported(mime)
    )
    if (supported.length === 0)
      throw new Error('This system has no supported screen recording format')
    if (!hasAudio) return supported[0]

    const outcome = await selectMimeType(supported, (mime) => this.probeCandidate(stream, mime), {
      maxProbes: DEFAULT_MAX_PROBES,
      budgetMs: DEFAULT_PROBE_BUDGET_MS,
      now: Date.now
    })
    for (const probe of outcome.probes) this.log(`Audio probe ${probe.mime}: ${probe.result}`)
    this.diagnostics.audio.probes = outcome.probes
    if (outcome.audioUnproven && outcome.probes.every((probe) => probe.result !== 'unknown')) {
      this.warn('Audio could not be added to the recording on this PC')
    }
    return outcome.mime
  }

  private async probeCandidate(stream: MediaStream, mime: string): Promise<ProbeOutcome> {
    try {
      const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128_000 })
      const parts: Blob[] = []
      recorder.ondataavailable = (event): void => {
        if (event.data.size > 0) parts.push(event.data)
      }
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = (): void => resolve()
        recorder.onerror = (): void => resolve()
      })
      recorder.start(250)
      await sleep(PROBE_DURATION_MS)
      if (recorder.state !== 'inactive') recorder.stop()
      await Promise.race([stopped, sleep(1500)])
      const bytes = new Uint8Array(await new Blob(parts).arrayBuffer())
      return detectAudioTrack(bytes.subarray(0, 256 * 1024), mime)
    } catch {
      return 'error'
    }
  }

  private createMediaRecorder(
    stream: MediaStream,
    mimeType: string,
    bitrate: number,
    hasAudio: boolean
  ): MediaRecorder {
    return new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: bitrate,
      ...(hasAudio ? { audioBitsPerSecond: 192_000 } : {})
    })
  }

  private async finishStop(mimeType: string): Promise<void> {
    if (this.finishing) return
    this.finishing = true
    if (this.finishFallback) clearTimeout(this.finishFallback)
    this.finishFallback = undefined
    this.stopTracks()
    let chunkWriteError: Error | undefined
    try {
      await this.chunkWriter?.flush()
    } catch (error) {
      chunkWriteError = error instanceof Error ? error : new Error(String(error))
    }

    if (this.fileStarted && this.sessionId) {
      const sessionId = this.sessionId
      const outcome = await closeRecordingFile(
        (args) => window.api.recordingStop({ sessionId, mimeType, ...args }),
        chunkWriteError
      )
      if (outcome.kind === 'saved') {
        this.callbacks.onFile(outcome.filePath)
        await this.verifySavedFile(outcome.filePath)
      } else {
        this.callbacks.onError(outcome.message)
      }
    }
    this.cleanup()
    this.callbacks.onStopped()
  }

  private async verifySavedFile(filePath: string): Promise<void> {
    if (!this.diagnostics.audio.requested) return
    try {
      const probe = await window.api.diagnosticsProbeFile(filePath)
      this.diagnostics.audio.fileHasAudio =
        probe === 'present' ? 'yes' : probe === 'absent' ? 'no' : 'unknown'
      this.log(`Saved file audio check: ${probe}`)
      if (probe === 'absent') this.warn('The saved file has no audio track.')
    } catch (error) {
      this.diagnostics.audio.fileHasAudio = 'unknown'
      this.log(`Saved file audio check failed: ${String(error)}`)
    }
    this.callbacks.onDiagnostics?.({
      ...this.diagnostics,
      video: { ...this.diagnostics.video },
      audio: { ...this.diagnostics.audio }
    })
  }

  private cleanup(): void {
    this.disposeCrop()
    if (this.diagnosticsTimer) clearInterval(this.diagnosticsTimer)
    this.diagnosticsTimer = undefined
    if (this.micStateTimer) clearInterval(this.micStateTimer)
    this.micStateTimer = undefined
    this.removeMicListener?.()
    this.removeMicListener = undefined
    this.micMuted = false
    this.denoiseActive = true
    this.removeStopListener?.()
    this.removeStopListener = undefined
    if (this.finishFallback) clearTimeout(this.finishFallback)
    this.finishFallback = undefined
    if (this.measurementVideo) {
      this.measurementVideo.pause()
      this.measurementVideo.srcObject = null
      this.measurementVideo.remove()
      this.measurementVideo = undefined
    }
    this.chunkWriter = undefined
    this.mediaRecorder = undefined
    this.stream = undefined
    this.sessionId = undefined
    this.recorderStarted = false
    this.fileStarted = false
  }

  private disposeCrop(): void {
    if (this.cropTimer) clearInterval(this.cropTimer)
    this.cropTimer = undefined
    this.cropSource?.getTracks().forEach((track) => track.stop())
    this.cropSource = undefined
    if (this.cropVideo) {
      this.cropVideo.pause()
      this.cropVideo.srcObject = null
      this.cropVideo = undefined
    }
  }

  /** Crops the captured screen to the chosen region by redrawing it onto a canvas stream. */
  private async cropDisplayStream(
    source: MediaStream,
    region: RegionFraction,
    fps: number
  ): Promise<MediaStream> {
    const video = document.createElement('video')
    video.muted = true
    video.srcObject = source
    this.cropVideo = video
    this.cropSource = source
    await video.play()
    if (video.videoWidth === 0) {
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = (): void => resolve()
        setTimeout(resolve, 2000)
      })
    }
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error(
        'The selected screen delivered no picture, so the region could not be cropped'
      )
    }
    const crop = fractionToPixels(region, video.videoWidth, video.videoHeight)
    const canvas = document.createElement('canvas')
    canvas.width = crop.width
    canvas.height = crop.height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Could not prepare the region crop')
    const draw = (): void => {
      context.drawImage(
        video,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height
      )
    }
    draw()
    this.cropTimer = setInterval(draw, Math.max(8, Math.round(1000 / fps)))
    const output = canvas.captureStream(fps)
    const sourceTrack = source.getVideoTracks()[0]
    if (sourceTrack) {
      sourceTrack.onended = (): void => {
        if (!this.stopped) {
          this.callbacks.onError('Screen capture stream ended')
          void this.stop()
        }
      }
    }
    this.log(
      `Region crop ${crop.width}x${crop.height} at ${crop.x},${crop.y} of ${video.videoWidth}x${video.videoHeight}`
    )
    return output
  }

  private stopTracks(): void {
    this.disposeCrop()
    this.stream?.getTracks().forEach((track) => track.stop())
    this.mediaRecorder?.stream.getTracks().forEach((track) => track.stop())
    this.microphone?.dispose()
    this.microphone = undefined
  }

  private measureFrames(video: VideoFrameCallbackVideo): void {
    if (typeof video.requestVideoFrameCallback !== 'function') return
    const callback = (now: number): void => {
      if (this.stopped) return
      this.frameTimes.push(now)
      this.frameTimes = this.frameTimes.filter((time) => now - time <= 1000)
      if (this.frameTimes.length >= 2) {
        const elapsed = now - this.frameTimes[0]
        const realFps = elapsed > 0 ? ((this.frameTimes.length - 1) * 1000) / elapsed : 0
        this.lastRealFps = realFps
        this.callbacks.onRealFps(realFps)
      }
      video.requestVideoFrameCallback(callback)
    }
    video.requestVideoFrameCallback(callback)
  }
}
