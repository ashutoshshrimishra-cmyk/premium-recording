import { log } from './logger'

export interface ClickEvent {
  /** Screen coordinates (DIP on Windows are not guaranteed, see the caller). */
  x: number
  y: number
  button: 'left' | 'right'
}

interface UiohookModule {
  uIOhook: {
    on: (
      event: string,
      listener: (event: { x: number; y: number; button?: number }) => void
    ) => void
    removeAllListeners: (event?: string) => void
    start: () => void
    stop: () => void
  }
}

let hook: UiohookModule['uIOhook'] | undefined
let started = false

/**
 * Starts the optional global mouse hook. The module is a native addon, so a failure to load it
 * is logged and ignored. DOM mousedown handling in the canvas still works in drawing mode.
 */
export function startCursorHook(onClick: (event: ClickEvent) => void): void {
  if (started) return
  try {
    // Guarded dynamic require: the app must start even if the addon is missing.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('uiohook-napi') as UiohookModule
    hook = loaded.uIOhook
    hook.on('mousedown', (event) => {
      const button = event.button === 2 ? 'right' : event.button === 1 ? 'left' : undefined
      if (button) onClick({ x: event.x, y: event.y, button })
    })
    hook.start()
    started = true
    log('info', 'Global mouse hook started')
  } catch (error) {
    hook = undefined
    log('warn', 'Global mouse hook unavailable, click effects work only while drawing', error)
  }
}

export function stopCursorHook(): void {
  if (!started || !hook) return
  try {
    hook.removeAllListeners()
    hook.stop()
  } catch (error) {
    log('warn', 'Could not stop the global mouse hook', error)
  }
  hook = undefined
  started = false
}
