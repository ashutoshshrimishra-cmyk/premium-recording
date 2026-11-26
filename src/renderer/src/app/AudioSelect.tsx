import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Mic } from 'lucide-react'
import { useRecorderStore } from './store'
import { meterLevelFromSamples, smoothMeter } from '../recorder/audioMath'

function micErrorMessage(reason: unknown): string {
  if (reason instanceof DOMException && reason.name === 'NotAllowedError') {
    return 'Microphone access was blocked. Allow microphone access in Windows privacy settings.'
  }
  if (reason instanceof DOMException && reason.name === 'NotFoundError') {
    return 'No microphone was found.'
  }
  return reason instanceof Error ? reason.message : 'The microphone could not be opened'
}

/** Live input level for the selected microphone, so the user can see that it works. */
function useMicLevel(deviceId: string, onError: (message: string) => void): number {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    if (deviceId === 'none') return undefined
    let cancelled = false
    let frame = 0
    let stream: MediaStream | undefined
    let context: AudioContext | undefined

    const run = async (): Promise<void> => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } },
          video: false
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 1024
        context.createMediaStreamSource(stream).connect(analyser)
        const samples = new Float32Array(analyser.fftSize)
        let smoothed = 0
        const tick = (): void => {
          analyser.getFloatTimeDomainData(samples)
          smoothed = smoothMeter(smoothed, meterLevelFromSamples(samples))
          setLevel(smoothed)
          frame = requestAnimationFrame(tick)
        }
        tick()
      } catch (reason) {
        if (!cancelled) onError(micErrorMessage(reason))
      }
    }
    void run()

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((track) => track.stop())
      void context?.close().catch(() => undefined)
      setLevel(0)
    }
  }, [deviceId, onError])

  return deviceId === 'none' ? 0 : level
}

export const AudioSelect = memo(function AudioSelect() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [error, setError] = useState('')
  const permissionAsked = useRef(false)
  const audioDeviceId = useRecorderStore((state) => state.audioDeviceId)
  const setAudioDeviceId = useRecorderStore((state) => state.setAudioDeviceId)
  const level = useMicLevel(audioDeviceId, setError)

  const refreshDevices = useCallback(async (): Promise<void> => {
    try {
      // Device labels are empty until microphone permission has been granted once.
      if (!permissionAsked.current) {
        permissionAsked.current = true
        try {
          const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          probe.getTracks().forEach((track) => track.stop())
        } catch (reason) {
          setError(micErrorMessage(reason))
        }
      }
      const result = await navigator.mediaDevices.enumerateDevices()
      const inputs = result.filter(
        (device) => device.kind === 'audioinput' && device.deviceId !== 'default'
      )
      setDevices(inputs)
      // A saved microphone that is no longer plugged in falls back to the default one.
      const saved = useRecorderStore.getState().audioDeviceId
      if (
        inputs.length > 0 &&
        saved !== 'default' &&
        saved !== 'none' &&
        !inputs.some((device) => device.deviceId === saved)
      ) {
        useRecorderStore.getState().setAudioDeviceId('default')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Microphones could not be listed')
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => void refreshDevices(), 0)
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
    return () => {
      clearTimeout(timer)
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices)
    }
  }, [refreshDevices])

  const handleChange = (value: string): void => {
    setError('')
    setAudioDeviceId(value)
  }

  return (
    <div>
      <label
        htmlFor="microphone-select"
        className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--muted)]"
      >
        <Mic className="size-3.5" aria-hidden="true" />
        Microphone
      </label>
      <select
        id="microphone-select"
        value={audioDeviceId}
        onChange={(event) => handleChange(event.target.value)}
        className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-hover)] px-3 text-sm outline-none"
      >
        <option value="default">Default microphone</option>
        {devices.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `Microphone ${index + 1}`}
          </option>
        ))}
        <option value="none">No microphone</option>
      </select>
      {audioDeviceId !== 'none' && (
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]"
          role="meter"
          aria-label="Microphone input level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
        >
          <div
            className="h-full rounded-full bg-[var(--accent)]"
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
})
