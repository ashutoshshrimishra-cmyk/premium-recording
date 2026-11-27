import { memo, useEffect, useRef, useState } from 'react'
import { Circle, Pause, Play, Square } from 'lucide-react'
import { useRecorderStore } from './store'
import { ScreenRecorder } from '../recorder/recorder'
import { formatDiagnostics, type RecordingDiagnostics } from '../recorder/diagnostics'
import { runCountdown } from '../recorder/countdown'
import { showShortcut } from './platform'
import type { MicChoice, MicFailure } from '../recorder/micFallback'

type RecorderStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping'

export const StartButton = memo(function StartButton() {
  const captureMode = useRecorderStore((state) => state.captureMode)
  const sourceId = useRecorderStore((state) => state.selectedSourceId)
  const region = useRecorderStore((state) => state.region)
  const fps = useRecorderStore((state) => state.fps)
  const resolution = useRecorderStore((state) => state.resolution)
  const saveDir = useRecorderStore((state) => state.saveDir)
  const audioDeviceId = useRecorderStore((state) => state.audioDeviceId)
  const noiseSuppression = useRecorderStore((state) => state.noiseSuppression)
  const shortcuts = useRecorderStore((state) => state.shortcuts)
  const countdownCancelled = useRef(false)
  const shortcutHandlerRef = useRef<(action: 'startStop' | 'pauseResume') => void>(() => undefined)
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
  const [warnings, setWarnings] = useState<string[]>([])
  const [diagnostics, setDiagnostics] = useState<RecordingDiagnostics | undefined>(undefined)
  const [logPath, setLogPath] = useState('')
  const [panelInVideo, setPanelInVideo] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [micPrompt, setMicPrompt] = useState<MicFailure | undefined>(undefined)
  const micResolveRef = useRef<((choice: MicChoice) => void) | undefined>(undefined)

  useEffect(() => {
    void window.api
      .diagnosticsGetInfo()
      .then((info) => {
        setLogPath(info.logPath)
        setPanelInVideo(info.captureMode === 'include-unprotected')
        void window.api.diagnosticsLog(
          `Renderer ready: v${__APP_VERSION__} (${__BUILD_COMMIT__}) built ${__BUILD_TIME__} | ${info.platform} ${info.osRelease}`
        )
      })
      .catch(() => undefined)
  }, [])

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current)
      micResolveRef.current?.('cancel')
      void recorderRef.current?.stop()
    },
    []
  )

  useEffect(() => window.api.onShortcutAction((action) => shortcutHandlerRef.current(action)), [])

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

  const answerMic = (choice: MicChoice): void => {
    const resolve = micResolveRef.current
    micResolveRef.current = undefined
    setMicPrompt(undefined)
    resolve?.(choice)
  }

  const start = async (): Promise<void> => {
    if (startingRef.current) return
    startingRef.current = true
    setMessage('')
    setWarnings([])
    setDiagnostics(undefined)
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
      onWarning: (warning) =>
        setWarnings((current) => (current.includes(warning) ? current : [...current, warning])),
      onDiagnostics: setDiagnostics,
      onMimeType: setMimeType,
      onRealFps: setRealFps,
      onFile: (filePath) => {
        setMessage(`Saved: ${filePath}`)
        void rememberRecording(filePath, accumulatedMsRef.current)
      },
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
        noiseSuppression,
        region: captureMode === 'region' ? region : undefined,
        onMicFailure: (failure) =>
          new Promise<MicChoice>((resolve) => {
            micResolveRef.current = resolve
            setMicPrompt(failure)
          })
      })
      timerRef.current = setInterval(updateElapsed, 250)
      startingRef.current = false
    } catch (error) {
      startingRef.current = false
      answerMic('cancel')
      recorderRef.current = undefined
      statusRef.current = 'idle'
      setStatus('idle')
      setMessage(error instanceof Error ? error.message : 'Recording could not start')
    }
  }

  const rememberRecording = async (filePath: string, durationMs: number): Promise<void> => {
    try {
      const list = await window.api.recentAdd(filePath, durationMs)
      useRecorderStore.getState().setRecent(list)
      if (useRecorderStore.getState().openFolderAfterSave) await window.api.recentShow(filePath)
    } catch {
      // The recording is saved, only the recent list could not be updated.
    }
  }

  const begin = async (): Promise<void> => {
    if (startingRef.current || countdown !== null) return
    const seconds = useRecorderStore.getState().countdownSeconds
    if (seconds > 0) {
      countdownCancelled.current = false
      setMessage('')
      const finished = await runCountdown(
        seconds,
        setCountdown,
        () => countdownCancelled.current,
        (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      )
      setCountdown(null)
      if (!finished) return
    }
    await start()
  }

  const cancelCountdown = (): void => {
    countdownCancelled.current = true
  }

  const stop = (): void => {
    answerMic('cancel')
    void recorderRef.current?.stop()
  }
  const pause = (): void => recorderRef.current?.pause()
  const resume = (): void => recorderRef.current?.resume()
  const sourceMatchesMode =
    captureMode === 'window' ? sourceId.startsWith('window:') : sourceId.startsWith('screen:')
  const enabled =
    sourceMatchesMode && saveDir.length > 0 && (captureMode !== 'region' || region !== undefined)
  const isActive = status !== 'idle'
  const counting = countdown !== null
  shortcutHandlerRef.current = (action): void => {
    if (action === 'pauseResume') {
      if (statusRef.current === 'recording') pause()
      else if (statusRef.current === 'paused') resume()
      return
    }
    if (counting) cancelCountdown()
    else if (statusRef.current === 'recording' || statusRef.current === 'paused') stop()
    else if (statusRef.current === 'idle' && enabled) void begin()
  }
  const micLevel = diagnostics
    ? Math.min(1, Math.max(diagnostics.audio.rawLevel, diagnostics.audio.processedLevel) * 2)
    : 0
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
                  ? 'Saving recording'
                  : status === 'starting'
                    ? 'Starting'
                    : 'Recording'}{' '}
              {timer}
            </span>
            <span>{realFps.toFixed(1)} real FPS</span>
          </div>
          {status === 'stopping' && (
            <div
              className="mt-2 h-1.5 overflow-hidden rounded bg-[var(--border)]"
              role="progressbar"
              aria-label="Saving recording"
            >
              <div className="h-full w-1/3 animate-pulse rounded bg-[var(--accent)]" />
            </div>
          )}
          {mimeType && (
            <div className="mt-1 text-[var(--muted)]">
              {mimeType.includes('mp4') ? 'MP4' : 'WebM'} · {mimeType}
            </div>
          )}
          <div className="mt-1 text-[var(--muted)]">
            The annotation panel is on the right side of the screen. Drag it to move it or use its
            dock buttons. It is not recorded. Mouse mode lets you use the desktop ·{' '}
            {showShortcut(shortcuts.toggleAnnotation)} toggles it ·{' '}
            {showShortcut(shortcuts.startStop)} stops · {showShortcut(shortcuts.pauseResume)} pauses
          </div>
        </div>
      )}
      {isActive && diagnostics?.audio.requested && (
        <div className="mb-2" aria-label="Microphone level">
          <div className="h-1.5 overflow-hidden rounded bg-[var(--border)]">
            <div
              className="h-full bg-[var(--accent)]"
              style={{ width: `${Math.round(micLevel * 100)}%` }}
            />
          </div>
        </div>
      )}
      {warnings.length > 0 && (
        <ul
          role="alert"
          className="mb-2 list-disc rounded-lg border border-red-500/60 py-2 pr-3 pl-7 text-xs text-red-400"
        >
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {panelInVideo && (
        <p className="mb-2 text-[11px] text-[var(--muted)]">
          This Windows version cannot hide the annotation panel from screen capture, so the panel
          will appear in the recording. Update Windows to 10 version 2004 or later, or move the
          panel to a second display, to keep it out of the video.
        </p>
      )}
      {diagnostics && (
        <div className="mb-2 rounded-lg border border-[var(--border)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--muted)]">
          {formatDiagnostics(diagnostics).map((line) => (
            <div
              key={line}
              className={line.includes('file has audio: NO') ? 'text-red-400' : undefined}
            >
              {line}
            </div>
          ))}
        </div>
      )}
      {logPath && (
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-[var(--muted)]">
          <span className="truncate" title={logPath}>
            Log: {logPath}
          </span>
          <button
            type="button"
            onClick={() => void window.api.diagnosticsShowLog()}
            className="shrink-0 rounded border border-[var(--border)] px-2 py-1"
          >
            Open log folder
          </button>
        </div>
      )}
      {micPrompt && (
        <div
          role="alertdialog"
          aria-label="Microphone problem"
          className="mb-2 rounded-lg border border-red-500/60 px-3 py-2 text-xs"
        >
          <p className="mb-2 text-red-400">{micPrompt.message}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => answerMic('retry')}
              className="rounded border border-[var(--border)] px-2 py-1"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => answerMic('video-only')}
              className="rounded border border-[var(--border)] px-2 py-1"
            >
              Record without audio
            </button>
            <button
              type="button"
              onClick={() => answerMic('cancel')}
              className="rounded border border-[var(--border)] px-2 py-1"
            >
              Cancel
            </button>
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
      {!isActive && counting ? (
        <button
          type="button"
          onClick={cancelCountdown}
          className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-[var(--accent)] text-sm font-semibold"
        >
          <span className="text-2xl tabular-nums" role="timer" aria-live="polite">
            {countdown}
          </span>
          Recording starts, click to cancel ({showShortcut(shortcuts.startStop)})
        </button>
      ) : !isActive ? (
        <button
          type="button"
          disabled={!enabled}
          title={`Start recording (${showShortcut(shortcuts.startStop)})`}
          onClick={() => void begin()}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] text-sm font-semibold text-white hover:bg-[var(--accent-hover)] disabled:bg-[var(--border)] disabled:text-[var(--muted)]"
        >
          <Circle className="size-4" aria-hidden="true" />
          {captureMode === 'window'
            ? 'Start Window Recording'
            : captureMode === 'region'
              ? 'Start Region Recording'
              : 'Start Screen Recording'}
          <span className="text-xs font-normal opacity-80">
            {showShortcut(shortcuts.startStop)}
          </span>
        </button>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {status === 'paused' ? (
            <button
              type="button"
              onClick={resume}
              title={`Resume (${showShortcut(shortcuts.pauseResume)})`}
              className="flex h-10 items-center justify-center gap-1 rounded-lg border border-[var(--border)] text-sm"
            >
              <Play className="size-4" /> Resume
            </button>
          ) : (
            <button
              type="button"
              disabled={status !== 'recording'}
              onClick={pause}
              title={`Pause (${showShortcut(shortcuts.pauseResume)})`}
              className="flex h-10 items-center justify-center gap-1 rounded-lg border border-[var(--border)] text-sm disabled:text-[var(--muted)]"
            >
              <Pause className="size-4" /> Pause
            </button>
          )}
          <button
            type="button"
            disabled={status === 'stopping'}
            onClick={stop}
            title={`Stop (${showShortcut(shortcuts.startStop)})`}
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
