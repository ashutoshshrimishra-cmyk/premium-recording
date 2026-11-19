import { memo } from 'react'
import { Circle } from 'lucide-react'

export const StartButton = memo(function StartButton() {
  return (
    <button
      type="button"
      disabled
      className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--border)] text-sm font-semibold text-[var(--muted)]"
    >
      <Circle className="size-4" aria-hidden="true" />
      Recording: next phase
    </button>
  )
})
