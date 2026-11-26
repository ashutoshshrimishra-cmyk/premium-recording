import { memo, useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { GetSourcesOutput } from '../../../shared/ipc-schemas'
import { useRecorderStore } from './store'

export const SourceList = memo(function SourceList() {
  const [sources, setSources] = useState<GetSourcesOutput>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const selectedSourceId = useRecorderStore((state) => state.selectedSourceId)
  const setSelectedSourceId = useRecorderStore((state) => state.setSelectedSourceId)

  const loadSources = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await window.api.getSources()
      setSources(result)
      setError('')
      if (
        useRecorderStore.getState().selectedSourceId &&
        !result.some((source) => source.id === useRecorderStore.getState().selectedSourceId)
      ) {
        setSelectedSourceId('')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Screens could not be loaded')
    } finally {
      setLoading(false)
    }
  }, [setSelectedSourceId])

  useEffect(() => {
    void loadSources()
  }, [loadSources])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-2">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-medium text-[var(--muted)]">Available screens</span>
        <button
          type="button"
          onClick={() => void loadSources()}
          disabled={loading}
          aria-label="Refresh screens"
          className="rounded p-1 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {error ? (
        <div role="alert" className="rounded-lg border border-red-500/30 p-3 text-xs text-red-300">
          {error}
        </div>
      ) : !loading && sources.length === 0 ? (
        <p className="p-3 text-center text-xs text-[var(--muted)]">No screens are available.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {sources.map((source) => (
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
      )}
    </div>
  )
})
