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
  private animationId = 0
  private stopped = false
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
    this.callbacks.onStatus('starting')
    this.chunkWriter = new RecordingChunkWriter(
      (chunk) => window.api.recordingChunk(chunk),
      (error) => this.callbacks.onError(`Chunk write failed: ${error.message}`)
    )

    await window.api.recordingStart({
      sourceId: options.sourceId,
      fps: options.fps,
      width: options.width,
      height: options.height,
      saveDir: options.saveDir
    })

    let permissionStream: MediaStream
    try {
      permissionStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: options.fps, max: options.fps },
          width: { ideal: options.width },
          height: { ideal: options.height }
        },
        audio: false
      } as MediaStreamConstraints)
    } catch (error) {
      await window.api.recordingStop({ mimeType: 'video/mp4' }).catch(() => undefined)
      const message = error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Screen permission was denied'
        : error instanceof Error
          ? `Could not capture the screen: ${error.message}`
          : 'Could not capture the screen'
      throw new Error(message)
    }

    const track = permissionStream.getVideoTracks()[0]
    if (!track) {
      permissionStream.getTracks().forEach((item) => item.stop())
      await window.api.recordingStop({ mimeType: 'video/mp4' }).catch(() => undefined)
      throw new Error('No source selected')
    }

    this.stream = permissionStream
    const width = options.width
    const height = options.height
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      this.stopTracks()
      await window.api.recordingStop({ mimeType: 'video/mp4' }).catch(() => undefined)
      throw new Error('Could not create the recording canvas')
    }

    const video = document.createElement('video')
    video.muted = true
    video.srcObject = permissionStream
    await video.play()
    const draw = (): void => {
      if (this.stopped) return
      context.drawImage(video, 0, 0, width, height)
      this.animationId = requestAnimationFrame(draw)
    }
    this.animationId = requestAnimationFrame(draw)

    const drawStream = canvas.captureStream(options.fps)
    const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
    if (!mimeType) {
      this.stopTracks()
      await window.api.recordingStop({ mimeType: 'video/mp4' }).catch(() => undefined)
      throw new Error('This browser has no supported recording format')
    }

    this.callbacks.onMimeType(mimeType)
    this.mediaRecorder = new MediaRecorder(drawStream, { mimeType })
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

    this.measureFrames(video as VideoFrameCallbackVideo)
    this.mediaRecorder.start(1000)
    this.callbacks.onStatus('recording')
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
    cancelAnimationFrame(this.animationId)
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
