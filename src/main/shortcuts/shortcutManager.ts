import { globalShortcut, type WebContents } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { ShortcutFailure, ShortcutsConfig } from '../../shared/ipc-schemas'
import {
  SHORTCUT_ACTIONS,
  findDuplicates,
  validateAccelerator,
  type ShortcutAction
} from '../../shared/shortcuts'
import { log } from '../logger'
import { saveAnnotationScreenshot, toggleAnnotationInteractive } from '../windows/overlay'

let target: WebContents | undefined
let registered: string[] = []
let failures: ShortcutFailure[] = []
let current: ShortcutsConfig | undefined
let suspended = false

/** The main window renderer receives start/stop and pause/resume requests. */
export function setShortcutTarget(contents: WebContents): void {
  target = contents
}

function sendToRenderer(action: 'startStop' | 'pauseResume'): void {
  if (target && !target.isDestroyed()) target.send(IPC_CHANNELS.shortcutAction, action)
}

const handlers: Record<ShortcutAction, () => void> = {
  startStop: () => sendToRenderer('startStop'),
  pauseResume: () => sendToRenderer('pauseResume'),
  toggleAnnotation: () => {
    try {
      toggleAnnotationInteractive()
    } catch (error) {
      log('warn', 'Annotation shortcut failed', error)
    }
  },
  screenshot: () => {
    saveAnnotationScreenshot().catch((error: unknown) => {
      // Without a running overlay there is nothing to capture, which is not an error worth logging.
      if (!(error instanceof Error && /overlay is not running/i.test(error.message))) {
        log('warn', 'Screenshot shortcut failed', error)
      }
    })
  }
}

function unregisterAll(): void {
  for (const accelerator of registered) {
    try {
      globalShortcut.unregister(accelerator)
    } catch {
      // Already unregistered.
    }
  }
  registered = []
}

/** Registers every shortcut and reports per shortcut what could not be registered. Never throws. */
export function applyShortcuts(config: ShortcutsConfig): ShortcutFailure[] {
  unregisterAll()
  current = config
  failures = []
  if (suspended) return failures

  const duplicateActions = new Set(
    findDuplicates(config).flatMap((group) => group.actions.slice(1))
  )
  for (const action of SHORTCUT_ACTIONS) {
    const accelerator = config[action]
    const check = validateAccelerator(accelerator)
    if (!check.valid || !check.accelerator) {
      failures.push({ action, accelerator, reason: check.reason ?? 'Not a valid shortcut' })
      continue
    }
    if (duplicateActions.has(action)) {
      failures.push({ action, accelerator, reason: 'Already used by another action' })
      continue
    }
    try {
      if (globalShortcut.register(check.accelerator, handlers[action])) {
        registered.push(check.accelerator)
      } else {
        failures.push({
          action,
          accelerator,
          reason: 'Another app already uses this shortcut'
        })
      }
    } catch (error) {
      log('warn', `Could not register shortcut ${accelerator}`, error)
      failures.push({ action, accelerator, reason: 'The shortcut could not be registered' })
    }
  }
  if (failures.length > 0) log('warn', `Shortcut failures: ${JSON.stringify(failures)}`)
  return failures
}

export function getShortcutFailures(): ShortcutFailure[] {
  return failures
}

/** Temporarily frees all shortcuts, so the settings screen can capture key presses. */
export function suspendShortcuts(value: boolean): void {
  if (suspended === value) return
  suspended = value
  if (value) {
    unregisterAll()
    failures = []
  } else if (current) {
    applyShortcuts(current)
  }
}

export function unregisterShortcuts(): void {
  unregisterAll()
}
