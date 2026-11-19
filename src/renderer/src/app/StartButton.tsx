import { memo, useEffect, useRef, useState } from 'react'
import { Circle, Pause, Play, Square } from 'lucide-react'
import { useRecorderStore } from './store'
import { ScreenRecorder } from '../recorder/recorder'

export const StartButton = memo(function StartButton() {
  const captureMode = useRecorderStore((state) => state.captureMode)
  const sourceId = useRecorderStore((state) => state.selectedSourceId)
  const fps = useRecorderStore((state) => state.fps)
  const resolution = useRecorderStore((state) => state.resolution)
  const saveDir = useRecorderStore((state) => state.saveDir)
  const recorderRef = useRef<ScreenRecorder | undefined>(undefined)
  const startedAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const [status, setStatus] = useState<'idle' | 'starting' | 'recording' | 'paused' | 'stopping'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [realFps, setRealFps] = useState(0)
  const [mimeType, setMimeType] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  const start = async (): Promise<void> => {
    setMessage('')
    setElapsed(0)
    setRealFps(0)
    setMimeType('')
    const dimensions: Record<typeof resolution, [number, number]> = {
      '1080p': [1920, 1080],
      '1440p': [2560, 1440],
      '4K': [3840, 2160]
    }
    const [width, height] = dimensions[resolution]
    const recorder = new ScreenRecorder({
      onStatus: setStatus,
      onError: setMessage,
      onMimeType: setMimeType,
      onRealFps: setRealFps,
      onFile: (filePath) => setMessage(`Saved: ${filePath}`),
      onStopped: () => setStatus('idle')
    })
    recorderRef.current = recorder
    try {
      await recorder.start({ sourceId, fps, width, height, saveDir })
      startedAtRef.current = Date.now()
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000))
      }, 250)
    } catch (error) {
      setStatus('idle')
      setMessage(error instanceof Error ? error.message : 'Recording could not start')
    }
  }

  const stop = (): void => {
    if (timerRef.current) clearInterval(timerRef.current)
    void recorderRef.current?.stop()
  }

  const pause = (): void => recorderRef.current?.pause()
  const resume = (): void => recorderRef.current?.resume()
  const enabled = captureMode === 'screen' && sourceId.startsWith('screen:') && saveDir.length > 0
  const isActive = status === 'recording' || status === 'paused' || status === 'starting' || status === 'stopping'
  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <div>
      {isActive && (
        <div className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--panel-hover)] px-3 py-2 text-xs">
          <div className="flex items-center justify-between">
            <span>{status === 'paused' ? 'Paused' : status === 'stopping' ? 'Stopping' : 'Recording'} {timer}</span>
            <span>{realFps.toFixed(1)} real FPS</span>
          </div>
          {mimeType && <div className="mt-1 text-[var(--muted)]">{mimeType.includes('mp4') ? 'MP4' : 'WebM'} — {mimeType}</div>}
        </div>
      )}
      {message && (
        <div role="status" className="mb-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
          {message}
        </div>
      )}
      {!isActive ? (
        <button
          type="button"
          disabled={!enabled}
          onClick={() => void start()}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--border)] text-sm font-semibold text-[var(--text)] disabled:text-[var(--muted)]"
        >
          <Circle className="size-4" aria-hidden="true" />
          Start Screen Recording
        </button>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {status === 'paused' ? (
            <button type="button" onClick={resume} className="flex h-10 items-center justify-center gap-1 rounded-lg border border-[var(--border)] text-sm">
              <Play className="size-4" /> Resume
            </button>
          ) : (
            <button type="button" disabled={status !== 'recording'} onClick={pause} className="flex h-10 items-center justify-center gap-1 rounded-lg border border-[var(--border)] text-sm disabled:text-[var(--muted)]">
              <Pause className="size-4" /> Pause
            </button>
          )}
          <button type="button" disabled={status === 'stopping'} onClick={stop} className="flex h-10 items-center justify-center gap-1 rounded-lg border border-[var(--border)] text-sm disabled:text-[var(--muted)]">
            <Square className="size-4" /> Stop
          </button>
          <div className="flex h-10 items-center justify-center text-xs text-[var(--muted)]">{timer}</div>
        </div>
      )}
    </div>
  )
})
