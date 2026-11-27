import { memo, useCallback, useEffect, useState } from 'react'
import { FolderOpen, RotateCcw, Trash2 } from 'lucide-react'
import { useRecorderStore } from './store'
import { formatBytes } from '../../../shared/recentRecordings'
import type { AbandonedPart } from '../../../shared/ipc-schemas'

const fileName = (filePath: string): string => filePath.split(/[\\/]/).pop() ?? filePath

export const RecoveryBanner = memo(function RecoveryBanner() {
  const saveDir = useRecorderStore((state) => state.saveDir)
  const recoveryRevision = useRecorderStore((state) => state.recoveryRevision)
  const [parts, setParts] = useState<AbandonedPart[]>([])
  const [message, setMessage] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setParts(await window.api.recoveryList())
    } catch {
      setParts([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, saveDir, recoveryRevision])

  const run = async (action: () => Promise<string>): Promise<void> => {
    try {
      setMessage(await action())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The action failed')
    }
    await refresh()
  }

  if (parts.length === 0 && !message) return null

  return (
    <div
      role="status"
      className="mb-3 rounded-lg border border-[var(--border)] p-2 text-xs"
      aria-label="Unfinished recordings"
    >
      {parts.length > 0 && (
        <div className="mb-1 font-medium text-[var(--muted)]">
          Unfinished recordings found in your save folder
        </div>
      )}
      <ul className="max-h-24 overflow-y-auto">
        {parts.map((part) => (
          <li key={part.partPath} className="flex items-center gap-2 py-1">
            <div className="min-w-0 flex-1">
              <div className="truncate" title={part.partPath}>
                {fileName(part.suggestedFinalPath)}
              </div>
              <div className="text-[var(--muted)]">
                {formatBytes(part.sizeBytes)}, {new Date(part.modifiedAt).toLocaleString()}
              </div>
            </div>
            <button
              type="button"
              title="Recover"
              aria-label={`Recover ${fileName(part.suggestedFinalPath)}`}
              onClick={() =>
                void run(async () => {
                  const { filePath } = await window.api.recoveryRecover(part.partPath)
                  return `Recovered: ${filePath}`
                })
              }
              className="rounded border border-[var(--border)] p-1.5"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              title="Show in folder"
              aria-label={`Show ${fileName(part.partPath)} in folder`}
              onClick={() => void window.api.recoveryShow(part.partPath).catch(() => undefined)}
              className="rounded border border-[var(--border)] p-1.5"
            >
              <FolderOpen className="size-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              title="Delete"
              aria-label={`Delete ${fileName(part.partPath)}`}
              onClick={() =>
                void run(async () => {
                  await window.api.recoveryDiscard(part.partPath)
                  return 'Deleted the unfinished recording'
                })
              }
              className="rounded border border-[var(--border)] p-1.5"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {message && <div className="mt-1 break-all text-[var(--muted)]">{message}</div>}
    </div>
  )
})
