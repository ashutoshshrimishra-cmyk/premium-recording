import { memo, useEffect, useRef, useState } from 'react'
import { Circle, Pause, Play, Square } from 'lucide-react'
import { useRecorderStore } from './store'
import { ScreenRecorder } from '../recorder/recorder'

type RecorderStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping'

export const StartButton = memo(function StartButton() {
  const captureMode = useRecorderStore((state) => state.captureMode)
  const sourceId = useRecorderStore((state) => state.selectedSourceId)
  const fps = useRecorderStore((state) => state.fps)
  const resolution = useRecorderStore((state) => state.resolution)
  const saveDir = useRecorderStore((state) => state.saveDir)
  const audioDeviceId = useRecorderStore((state) => state.audioDeviceId)
  const noiseSuppression = useRecorderStore((state) => state.noiseSuppression)
  const recorderRef = useRef<ScreenRecorder | undefined>(undefined)
  const startingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const statusRef = useRef<RecorderStatus>('idle')
  const activeStartedAtRef = useRef(0)
  const accumulatedMsRef = useRef(0)
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [realFps, setRealFps] = useState(0)
  const [mimeType, setMimeType] = useState('')
  const [message, setMessage] = useState('')

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current)
      void recorderRef.current?.stop()
    },
    []
  )

  const updateStatus = (next: Exclude<RecorderStatus, 'idle'>): void => {
    const now = Date.now()
    if (statusRef.current === 'recording' && next !== 'recording') {
      accumulatedMsRef.current += now - activeStartedAtRef.current
    }
    if (statusRef.current !== 'recording' && next === 'recording') {
      activeStartedAtRef.current = now
    }
    statusRef.current = next
    setStatus(next)
  }

  const updateElapsed = (): void => {
    const activeMs = statusRef.current === 'recording' ? Date.now() - activeStartedAtRef.current : 0
    setElapsed(Math.floor((accumulatedMsRef.current + activeMs) / 1000))
  }

  const start = async (): Promise<void> => {
    if (startingRef.current) return
    startingRef.current = true
    setMessage('')
    setElapsed(0)
    setRealFps(0)
    setMimeType('')
    accumulatedMsRef.current = 0
    statusRef.current = 'idle'
    const dimensions: Record<typeof resolution, [number, number]> = {
      '1080p': [1920, 1080],
      '1440p': [2560, 1440],
      '4K': [3840, 2160]
    }
    const [width, height] = dimensions[resolution]
    const recorder = new ScreenRecorder({
      onStatus: updateStatus,
      onError: setMessage,
      onWarning: setMessage,
      onMimeType: setMimeType,
      onRealFps: setRealFps,
      onFile: (filePath) => setMessage(`Saved: ${filePath}`),
      onStopped: () => {
        updateElapsed()
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = undefined
        recorderRef.current = undefined
        statusRef.current = 'idle'
        setStatus('idle')
      }
    })
    recorderRef.current = recorder
    try {
      await recorder.start({
        sourceId,
        fps,
        width,
        height,
        saveDir,
        audioDeviceId,
        noiseSuppression
      })
      timerRef.current = setInterval(updateElapsed, 250)
      startingRef.current = false
    } catch (error) {
      startingRef.current = false
      recorderRef.current = undefined
      statusRef.current = 'idle'
      setStatus('idle')
      setMessage(error instanceof Error ? error.message : 'Recording could not start')
    }
  }

  const stop = (): void => void recorderRef.current?.stop()
  const pause = (): void => recorderRef.current?.pause()
  const resume = (): void => recorderRef.current?.resume()
  const enabled = captureMode === 'screen' && sourceId.startsWith('screen:') && saveDir.length > 0
  const isActive = status !== 'idle'
  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <div>
      {isActive && (
        <div className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--panel-hover)] px-3 py-2 text-xs">
          <div className="flex items-center justify-between">
            <span>
              {status === 'paused'
                ? 'Paused'
                : status === 'stopping'
                  ? 'Stopping'
                  : status === 'starting'
                    ? 'Starting'
                    : 'Recording'}{' '}
              {timer}
            </span>
            <span>{realFps.toFixed(1)} real FPS</span>
          </div>
          {mimeType && (
            <div className="mt-1 text-[var(--muted)]">
              {mimeType.includes('mp4') ? 'MP4' : 'WebM'} · {mimeType}
            </div>
          )}
          <div className="mt-1 text-[var(--muted)]">
            Draw on the overlay · Ctrl/Cmd+Shift+A toggles desktop mode · Ctrl/Cmd+Shift+S stops
          </div>
        </div>
      )}
      {message && (
        <div
          role="status"
          className="mb-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]"
        >
          {message}
        </div>
      )}
      {!isActive ? (
        <button
          type="button"
          disabled={!enabled}
          onClick={() => void start()}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] text-sm font-semibold text-white hover:bg-[var(--accent-hover)] disabled:bg-[var(--border)] disabled:text-[var(--muted)]"
        >
          <Circle className="size-4" aria-hidden="true" />
          Start Screen Recording
        </button>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {status === 'paused' ? (
            <button
              type="button"
              onClick={resume}
              className="flex h-10 items-center justify-center gap-1 rounded-lg border border-[var(--border)] text-sm"
            >
              <Play className="size-4" /> Resume
            </button>
          ) : (
            <button
              type="button"
              disabled={status !== 'recording'}
              onClick={pause}
              className="flex h-10 items-center justify-center gap-1 rounded-lg border border-[var(--border)] text-sm disabled:text-[var(--muted)]"
            >
              <Pause className="size-4" /> Pause
            </button>
          )}
          <button
            type="button"
            disabled={status === 'stopping'}
            onClick={stop}
            className="flex h-10 items-center justify-center gap-1 rounded-lg border border-[var(--border)] text-sm disabled:text-[var(--muted)]"
          >
            <Square className="size-4" /> Stop
          </button>
          <div className="flex h-10 items-center justify-center text-xs text-[var(--muted)]">
            {timer}
          </div>
        </div>
      )}
    </div>
  )
})
