import { NoiseSuppressorWorklet_Name } from '@timephy/rnnoise-wasm'
// `?worker&url` makes Vite bundle the worklet (wasm is inlined) as a separate asset and return its URL.
import noiseSuppressorWorkletUrl from '@timephy/rnnoise-wasm/NoiseSuppressorWorklet?worker&url'
import { RNNOISE_SAMPLE_RATE, peak, shouldBypassProcessed } from './audioMath'

export interface MicrophoneLevels {
  raw: number
  processed: number
}

export interface MicrophoneChain {
  /** The track to record. Processed when `denoised` is true, otherwise the raw microphone track. */
  track: MediaStreamTrack
  denoised: boolean
  deviceLabel: string
  /** Set when AI noise removal was requested but could not be used. */
  warning?: string
  contextState: string
  /** True once the failsafe switched the output from the processed chain to the raw signal. */
  isBypassed: () => boolean
  setProcessedActive: (active: boolean) => void
  setMuted: (muted: boolean) => void
  getLevels: () => MicrophoneLevels
  /** Called once when the failsafe bypasses the processed chain. */
  onBypass?: () => void
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
  const deviceLabel = rawTrack?.label ?? ''
  const plain = (warning?: string): MicrophoneChain => ({
    track: rawTrack,
    denoised: false,
    deviceLabel,
    warning,
    contextState: 'none',
    isBypassed: () => false,
    setProcessedActive: () => undefined,
    setMuted: (muted) => {
      rawTrack.enabled = !muted
    },
    getLevels: () => ({ raw: 0, processed: 0 }),
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
    await Promise.race([
      context.resume(),
      new Promise<void>((resolve) => setTimeout(resolve, 2000))
    ])
    if (context.state !== 'running') {
      throw new Error(`The audio context is ${context.state}`)
    }

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
    const rawAnalyser = context.createAnalyser()
    const processedAnalyser = context.createAnalyser()
    rawAnalyser.fftSize = 1024
    processedAnalyser.fftSize = 1024
    const rawGain = context.createGain()
    rawGain.gain.value = 0
    const procGain = context.createGain()
    procGain.gain.value = 1
    const masterGain = context.createGain()
    masterGain.gain.value = 1

    source.connect(rawAnalyser)
    source.connect(rawGain)
    rawGain.connect(masterGain)
    source.connect(highPass)
    highPass.connect(denoiser)
    denoiser.connect(compressor)
    compressor.connect(makeup)
    makeup.connect(limiter)
    limiter.connect(processedAnalyser)
    limiter.connect(procGain)
    procGain.connect(masterGain)
    masterGain.connect(destination)

    const processed = destination.stream.getAudioTracks()[0]
    if (!processed) throw new Error('The audio pipeline produced no track')
    const ctx = context
    const rawBuffer = new Float32Array(rawAnalyser.fftSize)
    const processedBuffer = new Float32Array(processedAnalyser.fftSize)
    let bypassed = false
    let processedActive = true
    const startedAt = Date.now()
    const readLevels = (): MicrophoneLevels => {
      rawAnalyser.getFloatTimeDomainData(rawBuffer)
      processedAnalyser.getFloatTimeDomainData(processedBuffer)
      return { raw: peak(rawBuffer), processed: peak(processedBuffer) }
    }
    const applyRouting = (): void => {
      const useProcessed = processedActive && !bypassed
      procGain.gain.value = useProcessed ? 1 : 0
      rawGain.gain.value = useProcessed ? 0 : 1
    }
    let peakRaw = 0
    let peakProcessed = 0
    // Highest processed level ever seen. The failsafe only fires when the chain never produced sound,
    // so a denoiser that legitimately silences background noise is not bypassed.
    let maxProcessed = 0
    const chain: MicrophoneChain = {
      track: processed,
      denoised: true,
      deviceLabel,
      contextState: ctx.state,
      isBypassed: () => bypassed,
      setProcessedActive: (active) => {
        processedActive = active
        applyRouting()
      },
      setMuted: (muted) => {
        masterGain.gain.value = muted ? 0 : 1
      },
      getLevels: () => {
        const levels = readLevels()
        peakRaw = Math.max(peakRaw * 0.9, levels.raw)
        peakProcessed = Math.max(peakProcessed * 0.9, levels.processed)
        maxProcessed = Math.max(maxProcessed, levels.processed)
        chain.contextState = ctx.state
        if (
          !bypassed &&
          processedActive &&
          shouldBypassProcessed(peakRaw, maxProcessed, Date.now() - startedAt)
        ) {
          bypassed = true
          applyRouting()
          chain.onBypass?.()
        }
        return { raw: peakRaw, processed: peakProcessed }
      },
      dispose: () => {
        stopStream(destination.stream)
        stopStream(stream)
        void ctx.close().catch(() => undefined)
      }
    }
    return chain
  } catch (error) {
    console.error('AI noise removal unavailable, using the basic microphone stream', error)
    void context?.close().catch(() => undefined)
    const detail = error instanceof Error ? error.message : String(error)
    return plain(`AI noise removal could not start (${detail}). Using standard noise suppression.`)
  }
}
