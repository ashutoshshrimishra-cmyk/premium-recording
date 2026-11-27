import { memo } from 'react'
import { FolderOpen } from 'lucide-react'
import { useRecorderStore } from './store'

export const SaveLocation = memo(function SaveLocation() {
  const saveDir = useRecorderStore((state) => state.saveDir)
  const setSaveDir = useRecorderStore((state) => state.setSaveDir)

  const pickFolder = async (): Promise<void> => {
    const folder = await window.api.pickFolder()
    if (folder) setSaveDir(folder)
  }

  return (
    <div className="mb-3">
      <label className="mb-2 block text-xs font-medium text-[var(--muted)]">Save to</label>
      <button
        type="button"
        onClick={() => void pickFolder()}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-hover)] px-3 text-left text-sm"
      >
        <FolderOpen className="size-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
        <span className="truncate">{saveDir || 'Choose a folder'}</span>
      </button>
    </div>
  )
})
