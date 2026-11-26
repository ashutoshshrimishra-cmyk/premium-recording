import { app } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_LOG_BYTES = 1024 * 1024
let logFile: string | undefined

export function getLogPath(): string {
  logFile ??= join(app.getPath('userData'), 'logs', 'premium-recording.log')
  return logFile
}

/** Appends a timestamped line to the log file. Never throws. */
export function log(level: 'info' | 'warn' | 'error', message: string, error?: unknown): void {
  try {
    const path = getLogPath()
    mkdirSync(join(path, '..'), { recursive: true })
    try {
      if (statSync(path).size > MAX_LOG_BYTES) renameSync(path, `${path}.old`)
    } catch {
      // The file does not exist yet.
    }
    const detail =
      error === undefined
        ? ''
        : ` | ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
    appendFileSync(path, `${new Date().toISOString()} [${level}] ${message}${detail}\n`)
  } catch {
    // Logging must never break the app.
  }
  if (level === 'error') console.error(message, error ?? '')
}
