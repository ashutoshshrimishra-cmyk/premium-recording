import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { useRecorderStore } from './store'
import { ResolutionFpsPicker } from './ResolutionFpsPicker'
import { AudioSelect } from './AudioSelect'
import { NoiseToggle } from './NoiseToggle'
import { SaveLocation } from './SaveLocation'
import { isMac, showShortcut } from './platform'
import { COUNTDOWN_OPTIONS } from '../recorder/countdown'
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  SHORTCUT_LABELS,
  acceleratorFromKeyEvent,
  findDuplicates,
  validateAccelerator,
  type ShortcutAction
} from '../../../shared/shortcuts'
import type { ShortcutFailure } from '../../../shared/ipc-schemas'

function Section(props: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <h2 className="mb-3 text-sm font-semibold">{props.title}</h2>
      <div className="flex flex-col gap-4">{props.children}</div>
    </section>
  )
}

function Switch(props: {
  label: string
  hint?: string
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm">{props.label}</div>
        {props.hint && <p className="mt-0.5 text-xs text-[var(--muted)]">{props.hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.label}
        onClick={() => props.onChange(!props.checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          props.checked ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
        }`}
      >
        <span
          className={`absolute top-1 size-4 rounded-full bg-white transition-transform ${
            props.checked ? 'left-6' : 'left-1'
          }`}
        />
      </button>
    </div>
  )
}

const Behaviour = memo(function Behaviour() {
  const countdownSeconds = useRecorderStore((state) => state.countdownSeconds)
  const openFolderAfterSave = useRecorderStore((state) => state.openFolderAfterSave)
  const cursorEffect = useRecorderStore((state) => state.cursorEffect)
  const annotationStartsActive = useRecorderStore((state) => state.annotationStartsActive)
  const setBehaviour = useRecorderStore((state) => state.setBehaviour)

  return (
    <Section title="Behaviour">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="countdown-select" className="text-sm">
          Countdown before recording
        </label>
        <select
          id="countdown-select"
          value={countdownSeconds}
          onChange={(event) =>
            setBehaviour({
              countdownSeconds: Number(event.target.value) as (typeof COUNTDOWN_OPTIONS)[number]
            })
          }
          className="h-9 rounded-lg border border-[var(--border)] bg-[var(--panel-hover)] px-3 text-sm outline-none"
        >
          {COUNTDOWN_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value === 0 ? 'Off' : `${value} seconds`}
            </option>
          ))}
        </select>
      </div>
      <Switch
        label="Show the folder after saving"
        checked={openFolderAfterSave}
        onChange={(value) => setBehaviour({ openFolderAfterSave: value })}
      />
      <Switch
        label="Cursor highlight and click effect"
        hint="Turn off to start every recording without the yellow halo and click ring."
        checked={cursorEffect}
        onChange={(value) => setBehaviour({ cursorEffect: value })}
      />
      <Switch
        label="Start with drawing tools active"
        hint="Turn off to start in mouse mode, so you can use the desktop right away."
        checked={annotationStartsActive}
        onChange={(value) => setBehaviour({ annotationStartsActive: value })}
      />
    </Section>
  )
})

const Shortcuts = memo(function Shortcuts() {
  const shortcuts = useRecorderStore((state) => state.shortcuts)
  const setShortcuts = useRecorderStore((state) => state.setShortcuts)
  const [capturing, setCapturing] = useState<ShortcutAction | undefined>(undefined)
  const [errors, setErrors] = useState<Partial<Record<ShortcutAction, string>>>({})
  const capturingRef = useRef<ShortcutAction | undefined>(undefined)

  const showFailures = useCallback((failed: ShortcutFailure[]): void => {
    const next: Partial<Record<ShortcutAction, string>> = {}
    for (const failure of failed) next[failure.action] = failure.reason
    setErrors(next)
  }, [])

  useEffect(() => {
    void window.api
      .shortcutsGet()
      .then((result) => {
        setShortcuts(result.shortcuts)
        showFailures(result.failed)
      })
      .catch(() => undefined)
  }, [setShortcuts, showFailures])

  const stopCapture = useCallback((): void => {
    if (!capturingRef.current) return
    capturingRef.current = undefined
    setCapturing(undefined)
    void window.api.shortcutsSuspend(false).catch(() => undefined)
  }, [])

  // Shortcuts are freed while a key is being captured and restored when leaving the screen.
  useEffect(() => () => stopCapture(), [stopCapture])

  const save = async (next: typeof shortcuts, action: ShortcutAction): Promise<void> => {
    const result = await window.api.shortcutsSet(next)
    if (result.failed.length === 0 || result.failed.every((item) => item.action !== action)) {
      setShortcuts(result.shortcuts)
    }
    showFailures(result.failed)
  }

  const startCapture = (action: ShortcutAction): void => {
    capturingRef.current = action
    setCapturing(action)
    void window.api.shortcutsSuspend(true).catch(() => undefined)
  }

  const onKeyDown = (action: ShortcutAction, event: React.KeyboardEvent): void => {
    if (capturing !== action) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      stopCapture()
      return
    }
    const accelerator = acceleratorFromKeyEvent(event.nativeEvent, isMac)
    if (!accelerator) return
    const check = validateAccelerator(accelerator)
    if (!check.valid || !check.accelerator) {
      setErrors((current) => ({ ...current, [action]: check.reason }))
      return
    }
    const next = { ...shortcuts, [action]: check.accelerator }
    const clash = findDuplicates(next).find((group) => group.actions.includes(action))
    if (clash) {
      const other = clash.actions.find((item) => item !== action)
      setErrors((current) => ({
        ...current,
        [action]: `Already used by "${other ? SHORTCUT_LABELS[other] : 'another action'}"`
      }))
      return
    }
    stopCapture()
    setErrors((current) => ({ ...current, [action]: undefined }))
    void save(next, action)
  }

  const reset = (action: ShortcutAction): void => {
    void save({ ...shortcuts, [action]: DEFAULT_SHORTCUTS[action] }, action)
  }

  return (
    <Section title="Shortcuts">
      <p className="-mt-2 text-xs text-[var(--muted)]">
        Click a shortcut, then press the new key combination. Escape cancels. Shortcuts work while
        another app is in front.
      </p>
      {SHORTCUT_ACTIONS.map((action) => (
        <div key={action}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{SHORTCUT_LABELS[action]}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => startCapture(action)}
                onKeyDown={(event) => onKeyDown(action, event)}
                onBlur={() => capturing === action && stopCapture()}
                aria-label={`Change shortcut: ${SHORTCUT_LABELS[action]}`}
                className={`h-9 min-w-40 rounded-lg border bg-[var(--panel-hover)] px-3 font-mono text-xs ${
                  capturing === action
                    ? 'border-[var(--accent)]'
                    : errors[action]
                      ? 'border-red-500/60'
                      : 'border-[var(--border)]'
                }`}
              >
                {capturing === action ? 'Press keys…' : showShortcut(shortcuts[action])}
              </button>
              <button
                type="button"
                onClick={() => reset(action)}
                disabled={shortcuts[action] === DEFAULT_SHORTCUTS[action]}
                title="Reset to default"
                aria-label={`Reset shortcut: ${SHORTCUT_LABELS[action]}`}
                className="flex size-9 items-center justify-center rounded-lg border border-[var(--border)] disabled:text-[var(--muted)]"
              >
                <RotateCcw className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          {errors[action] && (
            <p role="alert" className="mt-1 text-right text-xs text-red-400">
              {errors[action]}
            </p>
          )}
        </div>
      ))}
    </Section>
  )
})

export const SettingsView = memo(function SettingsView() {
  const setView = useRecorderStore((state) => state.setView)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setView('main')}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </button>
        <h1 className="text-base font-semibold">Settings</h1>
      </div>
      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-4">
        <Section title="Recording defaults">
          <ResolutionFpsPicker />
          <AudioSelect />
          <NoiseToggle />
          <SaveLocation />
        </Section>
        <Behaviour />
        <Shortcuts />
      </div>
    </div>
  )
})
