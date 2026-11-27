import { settingsSchema, shortcutsSchema, type Settings } from './ipc-schemas'
import { looksAbsolutePath } from './pathRules'

/**
 * Version of the stored settings layout. 1 is everything saved before 1.6.0 (no version field).
 * Bump it and add a step to `migrateSettings` when a field changes meaning or shape.
 */
export const SETTINGS_VERSION = 2

export interface SettingsMigration {
  settings: Settings
  /** Version found in the store (1 when missing). */
  fromVersion: number
  /** Fields that were invalid and replaced by their default. */
  reset: string[]
  /** True when the store should be rewritten with `settings` and SETTINGS_VERSION. */
  shouldWrite: boolean
}

type SettingsKey = keyof Settings
const FIELD_KEYS = Object.keys(settingsSchema.shape) as SettingsKey[]

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function storedVersion(raw: Record<string, unknown>): number {
  const version = raw.settingsVersion
  return typeof version === 'number' && Number.isInteger(version) && version > 0 ? version : 1
}

/**
 * Reads stored settings field by field. An invalid field falls back to its own default and the
 * other fields are kept, instead of resetting everything when one value is bad. A store written by
 * a newer version is read the same way but never rewritten, so a downgrade does not destroy it.
 */
export function migrateSettings(rawInput: unknown, defaults: Settings): SettingsMigration {
  const raw = asRecord(rawInput)
  const fromVersion = storedVersion(raw)
  const reset: string[] = []
  const result: Record<string, unknown> = {}

  for (const key of FIELD_KEYS) {
    if (key === 'shortcuts') continue
    const value = raw[key]
    const parsed = settingsSchema.shape[key].safeParse(value)
    const valid =
      parsed.success &&
      (key !== 'saveDir' || (typeof parsed.data === 'string' && looksAbsolutePath(parsed.data)))
    if (valid) {
      result[key] = parsed.data
    } else {
      result[key] = defaults[key]
      if (value !== undefined) reset.push(key)
    }
  }
  if (!result.audioDeviceId) result.audioDeviceId = defaults.audioDeviceId ?? 'default'

  const storedShortcuts = asRecord(raw.shortcuts)
  const shortcuts: Record<string, unknown> = {}
  for (const action of Object.keys(shortcutsSchema.shape) as (keyof Settings['shortcuts'])[]) {
    const value = storedShortcuts[action]
    const parsed = shortcutsSchema.shape[action].safeParse(value)
    if (parsed.success && value !== undefined) {
      shortcuts[action] = parsed.data
    } else {
      shortcuts[action] = defaults.shortcuts[action]
      if (value !== undefined) reset.push(`shortcuts.${action}`)
    }
  }
  result.shortcuts = shortcuts

  // Version steps go here, for example: if (fromVersion < 3) { ...rename a field... }
  const settings = settingsSchema.parse(result)
  return {
    settings,
    fromVersion,
    reset,
    shouldWrite:
      fromVersion <= SETTINGS_VERSION && (fromVersion < SETTINGS_VERSION || reset.length > 0)
  }
}
