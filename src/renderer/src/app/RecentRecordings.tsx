import { memo, useEffect } from 'react'
import { FileVideo, FolderOpen } from 'lucide-react'
import { useRecorderStore } from './store'
import { formatBytes, formatDuration } from '../../../shared/recentRecordings'

export const RecentRecordings = memo(function RecentRecordings() {
  const recent = useRecorderStore((state) => state.recent)
  const setRecent = useRecorderStore((state) => state.setRecent)

  useEffect(() => {
    void window.api
      .recentList()
      .then(setRecent)
      .catch(() => undefined)
  }, [setRecent])

  if (recent.length === 0) return null

  const fileName = (filePath: string): string => filePath.split(/[\\/]/).pop() ?? filePath

  return (
    <div className="mb-3">
      <div className="mb-2 text-xs font-medium text-[var(--muted)]">Recent recordings</div>
      <ul className="max-h-24 overflow-y-auto rounded-lg border border-[var(--border)]">
        {recent.map((item) => (
          <li
            key={item.filePath}
            className="flex items-center gap-2 border-b border-[var(--border)] px-2 py-1.5 text-xs last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate" title={item.filePath}>
                {fileName(item.filePath)}
              </div>
              <div className="text-[11px] text-[var(--muted)]">
                {formatDuration(item.durationMs)} · {formatBytes(item.sizeBytes)} ·{' '}
                {new Date(item.savedAt).toLocaleString()}
              </div>
            </div>
            <button
              type="button"
              title="Open file"
              aria-label={`Open ${fileName(item.filePath)}`}
              onClick={() => void window.api.recentOpen(item.filePath).catch(() => undefined)}
              className="rounded border border-[var(--border)] p-1.5"
            >
              <FileVideo className="size-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              title="Show in folder"
              aria-label={`Show ${fileName(item.filePath)} in folder`}
              onClick={() => void window.api.recentShow(item.filePath).catch(() => undefined)}
              className="rounded border border-[var(--border)] p-1.5"
            >
              <FolderOpen className="size-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
})
