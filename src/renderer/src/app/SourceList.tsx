import { memo, useEffect, useState } from 'react'
import type { GetSourcesOutput } from '../../../shared/ipc-schemas'
import { useRecorderStore } from './store'

export const SourceList = memo(function SourceList() {
  const [sources, setSources] = useState<GetSourcesOutput>([])
  const captureMode = useRecorderStore((state) => state.captureMode)
  const selectedSourceId = useRecorderStore((state) => state.selectedSourceId)
  const setSelectedSourceId = useRecorderStore((state) => state.setSelectedSourceId)

  useEffect(() => {
    let active = true
    void window.api.getSources().then((result) => {
      if (active) setSources(result)
    })
    return () => {
      active = false
    }
  }, [])

  const filtered = sources.filter((source) => {
    if (captureMode === 'screen') return source.id.startsWith('screen:')
    if (captureMode === 'window') return source.id.startsWith('window:')
    return true
  })

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-2">
      <div className="flex flex-col gap-1">
        {filtered.map((source) => (
          <button
            key={source.id}
            type="button"
            aria-pressed={selectedSourceId === source.id}
            onClick={() => setSelectedSourceId(source.id)}
            className={`flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors ${
              selectedSourceId === source.id
                ? 'border-[var(--accent)] bg-[var(--panel-hover)]'
                : 'border-transparent hover:bg-[var(--panel-hover)]'
            }`}
          >
            <img
              className="h-[88px] w-full rounded-md object-cover"
              src={source.thumbnail}
              alt=""
            />
            <span className="truncate px-0.5 text-xs font-medium text-[var(--text)]">
              {source.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
})
