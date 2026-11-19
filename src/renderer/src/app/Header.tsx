import { memo } from 'react'
import { MonitorUp } from 'lucide-react'

export const Header = memo(function Header() {
  return (
    <header className="flex h-9 items-center gap-2.5">
      <div className="flex size-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel)]">
        <MonitorUp className="size-4" aria-hidden="true" />
      </div>
      <span className="text-sm font-semibold tracking-tight">Premium Recording</span>
    </header>
  )
})
