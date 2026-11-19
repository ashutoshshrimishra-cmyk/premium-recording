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
  requestVideoFrameCallback(callback: (now: number, metadata: VideoFrameCallbackMetadata) => void): number
}

const MIME_TYPES = [
  'video/mp4;codecs=avc1',
  'video/webm;codecs=h264',
  'video/webm;codecs=vp9'
] as const

export class ScreenRecorder {
  private stream?: MediaStream
  private mediaRecorder?: MediaRecorder
  private stopped = false
  private fileStarted = false
  private frameTimes: number[] = []
  private chunkWriter?: RecordingChunkWriter

  constructor(private callbacks: RecorderCallbacks) {}

  async start(options: {
    sourceId: string
    fps: number
    width: number
    height: number
    saveDir: string
  }): Promise<void> {
    this.stopped = false
    this.fileStarted = false
    this.callbacks.onStatus('starting')
    this.chunkWriter = new RecordingChunkWriter(
      (chunk) => window.api.recordingChunk(chunk),
      (error) => this.callbacks.onError(`Chunk write failed: ${error.message}`)
    )

    // 1) Capture FIRST, while the click's user activation is still valid.
    //    No file is created yet, so a failed capture can never leave a 0-byte file.
    await window.api.recordingSelectSource({ sourceId: options.sourceId })
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
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
          : `Could not capture the screen: ${name} ${detail}`.trim()
      )
    }
    this.stream = stream
    if (this.stopped) {
      this.stopTracks()
      throw new Error('Recording was cancelled')
    }

    const track = stream.getVideoTracks()[0]
    if (!track) {
      this.stopTracks()
      throw new Error('No video track was returned by the screen capture')
    }

    const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
    if (!mimeType) {
      this.stopTracks()
      throw new Error('This app has no supported recording format')
    }
    this.callbacks.onMimeType(mimeType)

    // 2) Only now create the file (this also minimizes our window).
    try {
      await window.api.recordingStart({
        sourceId: options.sourceId,
        mimeType,
        fps: options.fps,
        width: options.width,
        height: options.height,
        saveDir: options.saveDir
      })
      this.fileStarted = true
      if (this.stopped) throw new Error('Recording was cancelled')

      // 3) Record the captured stream directly: no canvas, no animation-frame
      //    dependency, so it keeps working while our window is minimized.
      const bitrate = Math.min(40_000_000, Math.round(options.width * options.height * options.fps * 0.08))
      this.mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate })

      this.mediaRecorder.ondataavailable = (event): void => {
        this.chunkWriter?.enqueue(event.data)
      }
      this.mediaRecorder.onerror = (event): void => {
        this.callbacks.onError(`MediaRecorder error: ${String(event.error?.message || 'unknown error')}`)
      }
      this.mediaRecorder.onstop = (): void => {
        void this.finishStop(mimeType)
      }
      track.onended = (): void => {
        if (!this.stopped) {
          this.callbacks.onError('Screen capture stream ended')
          void this.stop()
        }
      }

      // FPS measurement only (does not feed the recording).
      const video = document.createElement('video')
      video.muted = true
      video.srcObject = stream
      void video.play().then(() => this.measureFrames(video as VideoFrameCallbackVideo)).catch(() => undefined)

      this.mediaRecorder.start(1000)
      this.callbacks.onStatus('recording')
    } catch (error) {
      this.stopTracks()
      if (this.fileStarted) {
        await window.api.recordingStop({ mimeType, discard: true }).catch(() => undefined)
      }
      throw error instanceof Error ? error : new Error('Could not start recording')
    }
  }

  pause(): void {
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.pause()
      this.callbacks.onStatus('paused')
    }
  }

  resume(): void {
    if (this.mediaRecorder?.state === 'paused') {
      this.mediaRecorder.resume()
      this.callbacks.onStatus('recording')
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.callbacks.onStatus('stopping')
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop()
      return
    }
    await this.finishStop(this.mediaRecorder?.mimeType || 'video/mp4')
  }

  private async finishStop(mimeType: string): Promise<void> {
    this.stopTracks()
    let chunkWriteError: Error | undefined
    try {
      await this.chunkWriter?.flush()
    } catch (error) {
      chunkWriteError = error instanceof Error ? error : new Error(String(error))
    }

    try {
      const result = await window.api.recordingStop({ mimeType })
      if (!chunkWriteError) this.callbacks.onFile(result.filePath)
    } catch (error) {
      this.callbacks.onError(error instanceof Error ? error.message : 'Could not close the recording')
    }
    this.callbacks.onStopped()
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
        this.callbacks.onRealFps(elapsed > 0 ? ((this.frameTimes.length - 1) * 1000) / elapsed : 0)
      }
      video.requestVideoFrameCallback(callback)
    }
    video.requestVideoFrameCallback(callback)
  }
}
