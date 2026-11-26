import { memo, useCallback, useEffect, useState } from 'react'
import { Mic } from 'lucide-react'
import { useRecorderStore } from './store'

export const AudioSelect = memo(function AudioSelect() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [error, setError] = useState('')
  const audioDeviceId = useRecorderStore((state) => state.audioDeviceId)
  const setAudioDeviceId = useRecorderStore((state) => state.setAudioDeviceId)

  const refreshDevices = useCallback(async (): Promise<void> => {
    try {
      const result = await navigator.mediaDevices.enumerateDevices()
      setDevices(result.filter((device) => device.kind === 'audioinput'))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Microphones could not be listed')
    }
  }, [])

  useEffect(() => {
    void refreshDevices()
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices)
  }, [refreshDevices])

  return (
    <div>
      <label className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--muted)]">
        <Mic className="size-3.5" aria-hidden="true" />
        Microphone
      </label>
      <select
        value={audioDeviceId}
        onChange={(event) => setAudioDeviceId(event.target.value)}
        className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-hover)] px-3 text-sm outline-none"
      >
        <option value="none">No microphone</option>
        <option value="default">Default microphone</option>
        {devices.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `Microphone ${index + 1}`}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
})
