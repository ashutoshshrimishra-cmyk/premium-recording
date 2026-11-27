import { memo, useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { GetSourcesOutput } from '../../../shared/ipc-schemas'
import { useRecorderStore } from './store'
import { RegionSelector } from './RegionSelector'

export const SourceList = memo(function SourceList() {
  const [sources, setSources] = useState<GetSourcesOutput>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const captureMode = useRecorderStore((state) => state.captureMode)
  const kind = captureMode === 'window' ? 'window' : 'screen'
  const selectedSourceId = useRecorderStore((state) => state.selectedSourceId)
  const setSelectedSourceId = useRecorderStore((state) => state.setSelectedSourceId)

  const loadSources = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await window.api.getSources({ kind })
      setSources(result)
      if (kind === 'screen' && result.length > 0 && !useRecorderStore.getState().selectedSourceId) {
        setSelectedSourceId(result[0].id)
      }
      setError('')
      if (
        useRecorderStore.getState().selectedSourceId &&
        !result.some((source) => source.id === useRecorderStore.getState().selectedSourceId)
      ) {
        setSelectedSourceId('')
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : kind === 'window'
            ? 'Windows could not be loaded'
            : 'Screens could not be loaded'
      )
    } finally {
      setLoading(false)
    }
  }, [kind, setSelectedSourceId])

  useEffect(() => {
    setSources([])
    void loadSources()
    const timer = setInterval(() => void loadSources(), kind === 'window' ? 5000 : 15000)
    return () => clearInterval(timer)
  }, [loadSources, kind])

  const selected = sources.find((source) => source.id === selectedSourceId)
  const noun = kind === 'window' ? 'windows' : 'screens'

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-2">
      {captureMode === 'window' && (
        <p className="mb-2 px-1 text-[11px] text-[var(--muted)]">
          Window mode records only that window. Annotation overlay and cursor effect are available
          in Screen and Region mode.
        </p>
      )}
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-medium text-[var(--muted)]">
          {kind === 'window'
            ? 'Open windows'
            : captureMode === 'region'
              ? 'Pick a screen, then drag a region'
              : 'Available screens'}
        </span>
        <button
          type="button"
          onClick={() => void loadSources()}
          disabled={loading}
          aria-label={`Refresh ${noun}`}
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
        <p className="p-3 text-center text-xs text-[var(--muted)]">No {noun} are available.</p>
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
                {source.label || source.name}
              </span>
            </button>
          ))}
        </div>
      )}
      {captureMode === 'region' && selected && <RegionSelector thumbnail={selected.thumbnail} />}
    </div>
  )
})
