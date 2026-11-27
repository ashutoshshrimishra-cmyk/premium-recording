import { memo } from 'react'

export const Header = memo(function Header() {
  return (
    <header className="flex h-9 items-center gap-2.5">
      <svg className="size-8 shrink-0" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#1b1f2b" />
        <path
          d="M5.5 10V5.5H10M22 5.5h4.5V10M26.5 22v4.5H22M10 26.5H5.5V22"
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="16" cy="16" r="8" fill="none" stroke="#f8fafc" strokeWidth="1.4" />
        <circle cx="16" cy="16" r="5.8" fill="#ef4444" />
      </svg>
      <span className="text-sm font-semibold tracking-tight">Premium Recording</span>
      <span className="ml-auto text-[11px] text-[var(--muted)]" title={`Built ${__BUILD_TIME__}`}>
        v{__APP_VERSION__} ({__BUILD_COMMIT__}) · {__BUILD_TIME__.slice(0, 16).replace('T', ' ')}
      </span>
    </header>
  )
})
