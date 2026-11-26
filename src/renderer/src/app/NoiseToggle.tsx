import { memo } from 'react'
import { AudioLines } from 'lucide-react'
import { useRecorderStore } from './store'

export const NoiseToggle = memo(function NoiseToggle() {
  const noiseSuppression = useRecorderStore((state) => state.noiseSuppression)
  const setNoiseSuppression = useRecorderStore((state) => state.setNoiseSuppression)

  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2 text-sm">
          <AudioLines className="size-4 text-[var(--muted)]" aria-hidden="true" />
          AI noise removal
        </div>
        <p className="mt-0.5 pl-6 text-xs text-[var(--muted)]">
          Removes keyboard, fan and background noise from your voice.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={noiseSuppression}
        aria-label="AI noise removal"
        onClick={() => setNoiseSuppression(!noiseSuppression)}
        className={`relative h-6 w-11 rounded-full transition-colors ${
          noiseSuppression ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
        }`}
      >
        <span
          className={`absolute top-1 size-4 rounded-full bg-white transition-transform ${
            noiseSuppression ? 'left-6' : 'left-1'
          }`}
        />
      </button>
    </div>
  )
})
