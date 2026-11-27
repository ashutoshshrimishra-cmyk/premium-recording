import { memo, useRef, useState } from 'react'
import { normalizeFraction, type RegionFraction } from '../recorder/cropMath'
import { useRecorderStore } from './store'

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export const RegionSelector = memo(function RegionSelector({ thumbnail }: { thumbnail: string }) {
  const region = useRecorderStore((state) => state.region)
  const setRegion = useRecorderStore((state) => state.setRegion)
  const frameRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const [draft, setDraft] = useState<RegionFraction | undefined>(undefined)

  const point = (event: React.PointerEvent): { x: number; y: number } => {
    const box = frameRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 }
    return {
      x: clamp01((event.clientX - box.left) / box.width),
      y: clamp01((event.clientY - box.top) / box.height)
    }
  }

  const shown = draft ?? region
  return (
    <div className="mt-2 px-1">
      <div
        ref={frameRef}
        role="application"
        aria-label="Drag to select the region to record"
        className="relative cursor-crosshair touch-none select-none overflow-hidden rounded-md border border-[var(--border)]"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          startRef.current = point(event)
          setDraft({ ...startRef.current, width: 0, height: 0 })
        }}
        onPointerMove={(event) => {
          const start = startRef.current
          if (!start) return
          const now = point(event)
          setDraft({ x: start.x, y: start.y, width: now.x - start.x, height: now.y - start.y })
        }}
        onPointerUp={(event) => {
          const start = startRef.current
          startRef.current = undefined
          if (!start) return
          const now = point(event)
          setDraft(undefined)
          setRegion(
            normalizeFraction({
              x: start.x,
              y: start.y,
              width: now.x - start.x,
              height: now.y - start.y
            })
          )
        }}
      >
        <img className="block w-full" src={thumbnail} alt="" draggable={false} />
        {shown &&
          (() => {
            const left = Math.min(shown.x, shown.x + shown.width)
            const top = Math.min(shown.y, shown.y + shown.height)
            return (
              <div
                className="pointer-events-none absolute border-2 border-[var(--accent)] bg-[var(--accent)]/20"
                style={{
                  left: `${left * 100}%`,
                  top: `${top * 100}%`,
                  width: `${Math.abs(shown.width) * 100}%`,
                  height: `${Math.abs(shown.height) * 100}%`
                }}
              />
            )
          })()}
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--muted)]">
        <span>
          {region
            ? `Region ${Math.round(region.width * 100)}% x ${Math.round(region.height * 100)}% of the screen`
            : 'Drag on the preview to choose the area to record.'}
        </span>
        {region && (
          <button
            type="button"
            onClick={() => setRegion(undefined)}
            className="rounded border border-[var(--border)] px-2 py-0.5"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
})
