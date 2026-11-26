import { memo } from 'react'
import { AppWindow, Monitor, Scan } from 'lucide-react'
import { type CaptureMode, useRecorderStore } from './store'

const modes: Array<{
  value: CaptureMode
  label: string
  icon: typeof Monitor
  available: boolean
}> = [
  { value: 'screen', label: 'Screen', icon: Monitor, available: true },
  { value: 'window', label: 'Window', icon: AppWindow, available: false },
  { value: 'region', label: 'Region', icon: Scan, available: false }
]

export const CaptureModePicker = memo(function CaptureModePicker() {
  const captureMode = useRecorderStore((state) => state.captureMode)
  const setCaptureMode = useRecorderStore((state) => state.setCaptureMode)

  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1">
      {modes.map(({ value, label, icon: Icon, available }) => (
        <button
          key={value}
          type="button"
          disabled={!available}
          title={available ? `${label} capture` : `${label} capture is not available yet`}
          aria-pressed={captureMode === value}
          onClick={() => setCaptureMode(value)}
          className={`flex h-9 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            captureMode === value
              ? 'bg-[var(--panel-hover)] text-[var(--text)]'
              : 'text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {label}
          {!available && <span className="sr-only">(coming soon)</span>}
        </button>
      ))}
    </div>
  )
})
