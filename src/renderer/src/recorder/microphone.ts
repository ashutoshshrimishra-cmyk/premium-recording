import { NoiseSuppressorWorklet_Name } from '@timephy/rnnoise-wasm'
// `?worker&url` makes Vite bundle the worklet (wasm is inlined) as a separate asset and return its URL.
import noiseSuppressorWorkletUrl from '@timephy/rnnoise-wasm/NoiseSuppressorWorklet?worker&url'
import { RNNOISE_SAMPLE_RATE } from './audioMath'

export interface MicrophoneChain {
  /** The track to record. Processed when `denoised` is true, otherwise the raw microphone track. */
  track: MediaStreamTrack
  denoised: boolean
  /** Set when AI noise removal was requested but could not be used. */
  warning?: string
  dispose: () => void
}

export interface MicrophoneOptions {
  deviceId: string
  noiseSuppression: boolean
}

function micConstraints(deviceId: string, noiseSuppression: boolean): MediaStreamConstraints {
  return {
    audio: {
      ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression,
      autoGainControl: true,
      channelCount: { ideal: 1 },
      sampleRate: { ideal: RNNOISE_SAMPLE_RATE }
    },
    video: false
  }
}

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop())
}

/**
 * Opens the microphone. With noise suppression on, the browser's own suppression is the base layer and the
 * signal then goes through: high-pass (80 Hz) -> RNNoise (AudioWorklet) -> compressor -> limiter.
 * If the worklet cannot load, the plain constraint-based stream is returned together with a warning.
 */
export async function openMicrophone(options: MicrophoneOptions): Promise<MicrophoneChain> {
  const stream = await navigator.mediaDevices.getUserMedia(
    micConstraints(options.deviceId, options.noiseSuppression)
  )
  const rawTrack = stream.getAudioTracks()[0]
  const plain = (warning?: string): MicrophoneChain => ({
    track: rawTrack,
    denoised: false,
    warning,
    dispose: () => stopStream(stream)
  })

  if (!rawTrack) {
    stopStream(stream)
    throw new Error('The microphone did not return an audio track')
  }
  if (!options.noiseSuppression) return plain()

  let context: AudioContext | undefined
  try {
    context = new AudioContext({ sampleRate: RNNOISE_SAMPLE_RATE, latencyHint: 'interactive' })
    await context.audioWorklet.addModule(noiseSuppressorWorkletUrl)
    await context.resume()

    const source = context.createMediaStreamSource(new MediaStream([rawTrack]))
    const highPass = context.createBiquadFilter()
    highPass.type = 'highpass'
    highPass.frequency.value = 80
    highPass.Q.value = 0.707

    const denoiser = new AudioWorkletNode(context, NoiseSuppressorWorklet_Name, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
      outputChannelCount: [1]
    })
    denoiser.onprocessorerror = (): void => console.error('RNNoise worklet processor error')

    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -26
    compressor.knee.value = 24
    compressor.ratio.value = 3
    compressor.attack.value = 0.008
    compressor.release.value = 0.25

    const makeup = context.createGain()
    makeup.gain.value = 1.4

    const limiter = context.createDynamicsCompressor()
    limiter.threshold.value = -3
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.001
    limiter.release.value = 0.1

    const destination = context.createMediaStreamDestination()
    source.connect(highPass)
    highPass.connect(denoiser)
    denoiser.connect(compressor)
    compressor.connect(makeup)
    makeup.connect(limiter)
    limiter.connect(destination)

    const processed = destination.stream.getAudioTracks()[0]
    if (!processed) throw new Error('The audio pipeline produced no track')
    const ctx = context
    return {
      track: processed,
      denoised: true,
      dispose: () => {
        stopStream(destination.stream)
        stopStream(stream)
        void ctx.close().catch(() => undefined)
      }
    }
  } catch (error) {
    console.error('AI noise removal unavailable, using the basic microphone stream', error)
    void context?.close().catch(() => undefined)
    const detail = error instanceof Error ? error.message : String(error)
    return plain(`AI noise removal could not start (${detail}). Using standard noise suppression.`)
  }
}
