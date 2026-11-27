import { statfs } from 'node:fs/promises'

export const DISK_CHECK_INTERVAL_MS = 30_000
/** Below this the user is warned once. */
export const DISK_LOW_BYTES = 2 * 1024 * 1024 * 1024
/**
 * Below this the recording is stopped and saved. At 4K/60 (about 60 Mbit/s) one check interval
 * writes roughly 225 MB, so 500 MB still leaves room to finish the file.
 */
export const DISK_CRITICAL_BYTES = 500 * 1024 * 1024

export type DiskSpaceLevel = 'ok' | 'low' | 'critical'

export interface DiskSpaceStatus {
  level: Exclude<DiskSpaceLevel, 'ok'>
  availableBytes: number
}

export function diskSpaceLevel(availableBytes: number): DiskSpaceLevel {
  if (availableBytes < DISK_CRITICAL_BYTES) return 'critical'
  if (availableBytes < DISK_LOW_BYTES) return 'low'
  return 'ok'
}

const SEVERITY: Record<DiskSpaceLevel, number> = { ok: 0, low: 1, critical: 2 }

/**
 * Checks free space in `directory` every `intervalMs` while recording. Reports each level once,
 * only when it gets worse. A failing check is ignored (the write path reports real errors).
 * Returns a stop function that is safe to call more than once.
 */
export function startDiskMonitor(
  directory: string,
  onStatus: (status: DiskSpaceStatus) => void,
  options: {
    intervalMs?: number
    freeBytes?: (directory: string) => Promise<number>
  } = {}
): () => void {
  const freeBytes =
    options.freeBytes ??
    (async (dir: string): Promise<number> => {
      const stats = await statfs(dir)
      return stats.bavail * stats.bsize
    })
  let reported: DiskSpaceLevel = 'ok'
  let stopped = false
  let checking = false
  const check = async (): Promise<void> => {
    if (stopped || checking) return
    checking = true
    try {
      const available = await freeBytes(directory)
      const level = diskSpaceLevel(available)
      if (!stopped && level !== 'ok' && SEVERITY[level] > SEVERITY[reported]) {
        reported = level
        onStatus({ level, availableBytes: available })
      }
    } catch {
      // Not critical, the next check tries again.
    } finally {
      checking = false
    }
  }
  const timer = setInterval(() => void check(), options.intervalMs ?? DISK_CHECK_INTERVAL_MS)
  timer.unref?.()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
