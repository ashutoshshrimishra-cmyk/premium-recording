import { memo } from 'react'
import type { Resolution } from './store'
import { useRecorderStore } from './store'

const resolutions: Resolution[] = ['1080p', '1440p', '4K']
const frameRates = [24, 30, 60]

export const ResolutionFpsPicker = memo(function ResolutionFpsPicker() {
  const resolution = useRecorderStore((state) => state.resolution)
  const fps = useRecorderStore((state) => state.fps)
  const setResolution = useRecorderStore((state) => state.setResolution)
  const setFps = useRecorderStore((state) => state.setFps)

  return (
    <div>
      <label className="mb-2 block text-xs font-medium text-[var(--muted)]">
        Quality
      </label>
      <div className="grid grid-cols-[1fr_100px] gap-2">
        <select
          value={resolution}
          onChange={(event) => setResolution(event.target.value as Resolution)}
          className="h-9 rounded-lg border border-[var(--border)] bg-[var(--panel-hover)] px-3 text-sm outline-none"
        >
          {resolutions.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select
          value={fps}
          onChange={(event) => setFps(Number(event.target.value))}
          className="h-9 rounded-lg border border-[var(--border)] bg-[var(--panel-hover)] px-3 text-sm outline-none"
        >
          {frameRates.map((value) => (
            <option key={value} value={value}>{value} FPS</option>
          ))}
        </select>
      </div>
    </div>
  )
})
