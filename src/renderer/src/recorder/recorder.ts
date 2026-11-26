import { RecordingChunkWriter } from './chunkWriter'

export interface RecorderCallbacks {
  onStatus: (status: 'starting' | 'recording' | 'paused' | 'stopping') => void
  onError: (message: string) => void
  onMimeType: (mimeType: string) => void
  onRealFps: (fps: number) => void
  onFile: (filePath: string) => void
  onStopped: () => void
}

interface VideoFrameCallbackVideo extends HTMLVideoElement {
  requestVideoFrameCallback(
    callback: (now: number, metadata: VideoFrameCallbackMetadata) => void
  ): number
}

const MIME_TYPES = [
  'video/mp4;codecs=avc1,aac',
  'video/mp4;codecs=avc1',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm'
] as const

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

  constructor(private callbacks: RecorderCallbacks) {}

  async start(options: {
    sourceId: string
    fps: number
    width: number
    height: number
    saveDir: string
    audioDeviceId: string
    noiseSuppression: boolean
  }): Promise<void> {
    this.stopped = false
    this.finishing = false
    this.recorderStarted = false
    this.fileStarted = false
    this.sessionId = undefined
    this.callbacks.onStatus('starting')

    await window.api.recordingSelectSource({ sourceId: options.sourceId })
    let displayStream: MediaStream
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: options.fps, max: options.fps },
          width: { ideal: options.width },
          height: { ideal: options.height }
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

    this.stream = displayStream
    if (this.stopped) {
      this.stopTracks()
      throw new Error('Recording was cancelled')
    }

    let microphoneStream: MediaStream | undefined
    try {
      if (options.audioDeviceId !== 'none') {
        microphoneStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(options.audioDeviceId && options.audioDeviceId !== 'default'
              ? { deviceId: { exact: options.audioDeviceId } }
              : {}),
            noiseSuppression: options.noiseSuppression,
            echoCancellation: true,
            autoGainControl: true
          },
          video: false
        })
      }
    } catch (error) {
      displayStream.getTracks().forEach((track) => track.stop())
      this.cleanup()
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not use the selected microphone: ${detail}`, { cause: error })
    }

    if (this.stopped) {
      displayStream.getTracks().forEach((track) => track.stop())
      microphoneStream?.getTracks().forEach((track) => track.stop())
      throw new Error('Recording was cancelled')
    }

    const stream = new MediaStream([
      ...displayStream.getVideoTracks(),
      ...(microphoneStream?.getAudioTracks() ?? [])
    ])
    this.stream = stream
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
    const bitrate = Math.min(40_000_000, Math.round(width * height * fps * 0.08))
    let recorder: MediaRecorder
    try {
      recorder = this.createMediaRecorder(stream, bitrate)
    } catch (error) {
      this.stopTracks()
      this.cleanup()
      throw error
    }
    const mimeType = recorder.mimeType
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
        this.finishFallback ??= setTimeout(() => void this.finishStop(this.mediaRecorder?.mimeType || 'video/webm'), 1000)
        return
      }
    }
    await this.finishStop(this.mediaRecorder?.mimeType || 'video/webm')
  }

  private createMediaRecorder(stream: MediaStream, bitrate: number): MediaRecorder {
    for (const mimeType of MIME_TYPES) {
      if (!MediaRecorder.isTypeSupported(mimeType)) continue
      try {
        return new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate })
      } catch {
        // Chromium can report support but still reject a specific track/codec combination.
      }
    }
    throw new Error('This system has no supported screen recording format')
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
      try {
        const result = await window.api.recordingStop({
          sessionId: this.sessionId,
          mimeType,
          discard: Boolean(chunkWriteError)
        })
        if (!chunkWriteError) this.callbacks.onFile(result.filePath)
      } catch (error) {
        if (!chunkWriteError) {
          this.callbacks.onError(
            error instanceof Error ? error.message : 'Could not close the recording'
          )
        }
      }
    }
    this.cleanup()
    this.callbacks.onStopped()
  }

  private cleanup(): void {
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

  private stopTracks(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.mediaRecorder?.stream.getTracks().forEach((track) => track.stop())
  }

  private measureFrames(video: VideoFrameCallbackVideo): void {
    if (typeof video.requestVideoFrameCallback !== 'function') return
    const callback = (now: number): void => {
      if (this.stopped) return
      this.frameTimes.push(now)
      this.frameTimes = this.frameTimes.filter((time) => now - time <= 1000)
      if (this.frameTimes.length >= 2) {
        const elapsed = now - this.frameTimes[0]
        this.callbacks.onRealFps(
          elapsed > 0 ? ((this.frameTimes.length - 1) * 1000) / elapsed : 0
        )
      }
      video.requestVideoFrameCallback(callback)
    }
    video.requestVideoFrameCallback(callback)
  }
}
