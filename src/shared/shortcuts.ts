/** Pure helpers for global shortcut (Electron accelerator) handling. Used by main and renderer. */

export const SHORTCUT_ACTIONS = [
  'startStop',
  'pauseResume',
  'toggleAnnotation',
  'screenshot'
] as const
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]
export type ShortcutMap = Record<ShortcutAction, string>

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  startStop: 'CommandOrControl+Shift+R',
  pauseResume: 'CommandOrControl+Shift+P',
  toggleAnnotation: 'CommandOrControl+Shift+A',
  screenshot: 'CommandOrControl+Shift+S'
}

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  startStop: 'Start / stop recording',
  pauseResume: 'Pause / resume recording',
  toggleAnnotation: 'Toggle drawing and mouse mode',
  screenshot: 'Save a screenshot'
}

const MODIFIER_ALIASES: Record<string, string> = {
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  control: 'Control',
  ctrl: 'Control',
  command: 'Command',
  cmd: 'Command',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super'
}
const MODIFIER_ORDER = ['CommandOrControl', 'Control', 'Command', 'Alt', 'Shift', 'Super']
/** Modifiers that make a shortcut safe for global use (Shift alone would block normal typing). */
const STRONG_MODIFIERS = ['CommandOrControl', 'Control', 'Command', 'Alt', 'Super']

const NAMED_KEYS: Record<string, string> = {
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  enter: 'Return',
  return: 'Return',
  plus: 'Plus'
}
const PUNCTUATION = "`-=[]\\;',./"

function normalizeKey(raw: string): string | undefined {
  if (/^[a-z0-9]$/i.test(raw)) return raw.toUpperCase()
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(raw)) return raw.toUpperCase()
  if (raw.length === 1 && PUNCTUATION.includes(raw)) return raw
  return NAMED_KEYS[raw.toLowerCase()]
}

export interface AcceleratorCheck {
  valid: boolean
  /** Canonical form, set when valid. */
  accelerator?: string
  reason?: string
}

/** Validates an accelerator string and returns its canonical form (stable modifier order, upper-case key). */
export function validateAccelerator(input: string): AcceleratorCheck {
  const text = input.trim()
  if (!text) return { valid: false, reason: 'Press a key combination' }
  const parts = text.split('+').map((part) => part.trim())
  // A literal "+" key is written as "Plus", so empty parts mean a malformed string.
  if (parts.some((part) => part.length === 0)) {
    return { valid: false, reason: 'Not a valid key combination' }
  }
  const key = parts[parts.length - 1]
  const modifiers = new Set<string>()
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (!modifier) return { valid: false, reason: `Unknown modifier "${part}"` }
    modifiers.add(modifier)
  }
  const normalizedKey = normalizeKey(key)
  if (!normalizedKey) return { valid: false, reason: `"${key}" cannot be used as a shortcut key` }
  const isFunctionKey = /^F\d+$/.test(normalizedKey)
  if (!isFunctionKey && !STRONG_MODIFIERS.some((modifier) => modifiers.has(modifier))) {
    return { valid: false, reason: 'Include Ctrl, Alt or Cmd so normal typing is not blocked' }
  }
  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier))
  return { valid: true, accelerator: [...ordered, normalizedKey].join('+') }
}

export interface ShortcutDuplicate {
  accelerator: string
  actions: ShortcutAction[]
}

/** Groups actions that use the same accelerator. Invalid accelerators are compared by lower-cased text. */
export function findDuplicates(shortcuts: ShortcutMap): ShortcutDuplicate[] {
  const groups = new Map<string, ShortcutAction[]>()
  for (const action of SHORTCUT_ACTIONS) {
    const check = validateAccelerator(shortcuts[action])
    const key = check.accelerator ?? shortcuts[action].trim().toLowerCase()
    groups.set(key, [...(groups.get(key) ?? []), action])
  }
  return [...groups.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([accelerator, actions]) => ({ accelerator, actions }))
}

export interface KeyEventLike {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** Builds an accelerator from a key event, or undefined while only modifier keys are held. */
export function acceleratorFromKeyEvent(event: KeyEventLike, isMac: boolean): string | undefined {
  let key: string | undefined
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3)
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5)
  else if (/^F\d+$/.test(event.key)) key = event.key
  else if (event.key === ' ') key = 'Space'
  else if (event.key.startsWith('Arrow')) key = event.key.slice(5)
  else if (event.key === 'Enter') key = 'Return'
  else if (event.key === '+') key = 'Plus'
  else key = event.key
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS'].includes(key)) return undefined

  const modifiers: string[] = []
  if (isMac) {
    if (event.metaKey) modifiers.push('CommandOrControl')
    if (event.ctrlKey) modifiers.push('Control')
  } else {
    if (event.ctrlKey) modifiers.push('CommandOrControl')
    if (event.metaKey) modifiers.push('Super')
  }
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  return [...modifiers, key].join('+')
}

/** Human readable form, e.g. "Ctrl+Shift+R" (or "Cmd+Shift+R" on macOS). */
export function displayAccelerator(accelerator: string, isMac: boolean): string {
  return accelerator
    .split('+')
    .map((part) => {
      if (part === 'CommandOrControl') return isMac ? 'Cmd' : 'Ctrl'
      if (part === 'Control') return 'Ctrl'
      if (part === 'Super') return isMac ? 'Cmd' : 'Win'
      if (part === 'Return') return 'Enter'
      return part
    })
    .join('+')
}
