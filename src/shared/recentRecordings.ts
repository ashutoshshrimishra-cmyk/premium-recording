import { MAX_PATH_LENGTH, looksAbsolutePath } from './pathRules'

export interface RecentRecordingEntry {
  filePath: string
  sizeBytes: number
  durationMs: number
  /** ISO date of when the recording was saved. */
  savedAt: string
}

export const MAX_RECENT_RECORDINGS = 10

/** Adds an entry at the top, removes an older entry for the same file and keeps the last 10. */
export function addRecent(
  list: readonly RecentRecordingEntry[],
  entry: RecentRecordingEntry,
  max = MAX_RECENT_RECORDINGS
): RecentRecordingEntry[] {
  const key = entry.filePath.toLowerCase()
  return [entry, ...list.filter((item) => item.filePath.toLowerCase() !== key)].slice(0, max)
}

function isRecentEntry(value: unknown): value is RecentRecordingEntry {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  const finiteNonNegative = (n: unknown): boolean =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0
  return (
    typeof item.filePath === 'string' &&
    item.filePath.length <= MAX_PATH_LENGTH &&
    looksAbsolutePath(item.filePath) &&
    /\.(?:mp4|webm)$/i.test(item.filePath) &&
    finiteNonNegative(item.sizeBytes) &&
    finiteNonNegative(item.durationMs) &&
    typeof item.savedAt === 'string' &&
    !Number.isNaN(Date.parse(item.savedAt))
  )
}

/**
 * Validates the persisted list entry by entry. Damaged or foreign entries (relative paths, other
 * file types, bad numbers) are dropped and the list is capped.
 */
export function sanitizeRecent(raw: unknown, max = MAX_RECENT_RECORDINGS): RecentRecordingEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isRecentEntry)
    .slice(0, max)
    .map(({ filePath, sizeBytes, durationMs, savedAt }) => ({
      filePath,
      sizeBytes,
      durationMs,
      savedAt
    }))
}

/** Drops entries whose file no longer exists. */
export function pruneMissing(
  list: readonly RecentRecordingEntry[],
  exists: (filePath: string) => boolean
): RecentRecordingEntry[] {
  return list.filter((item) => exists(item.filePath))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatDuration(durationMs: number): string {
  const total = Math.max(0, Math.round(durationMs / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}
