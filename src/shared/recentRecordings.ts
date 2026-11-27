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
