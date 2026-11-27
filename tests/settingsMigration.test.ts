import { describe, expect, it, vi } from 'vitest'
import { SETTINGS_VERSION, migrateSettings } from '../src/shared/settingsMigration'
import { DEFAULT_SHORTCUTS } from '../src/shared/shortcuts'
import type { Settings } from '../src/shared/ipc-schemas'
import {
  DISK_CRITICAL_BYTES,
  DISK_LOW_BYTES,
  diskSpaceLevel,
  startDiskMonitor
} from '../src/main/diskMonitor'

const defaults: Settings = {
  saveDir: '/home/u/Videos/MyRecorder',
  fps: 30,
  resolution: '1080p',
  noiseSuppression: true,
  audioDeviceId: 'default',
  countdownSeconds: 3,
  openFolderAfterSave: false,
  cursorEffect: true,
  annotationStartsActive: true,
  shortcuts: { ...DEFAULT_SHORTCUTS }
}

describe('settings migration', () => {
  it('upgrades 1.x settings (no version) and keeps every valid field', () => {
    const stored = {
      saveDir: 'D:\\Recordings',
      fps: 60,
      resolution: '4K',
      noiseSuppression: false,
      audioDeviceId: 'mic-1',
      countdownSeconds: 5,
      shortcuts: { startStop: 'Alt+F9' }
    }
    const result = migrateSettings(stored, defaults)
    expect(result.fromVersion).toBe(1)
    expect(result.shouldWrite).toBe(true)
    expect(result.reset).toEqual([])
    expect(result.settings).toMatchObject({
      saveDir: 'D:\\Recordings',
      fps: 60,
      resolution: '4K',
      noiseSuppression: false,
      audioDeviceId: 'mic-1',
      countdownSeconds: 5,
      openFolderAfterSave: false
    })
    expect(result.settings.shortcuts.startStop).toBe('Alt+F9')
    expect(result.settings.shortcuts.screenshot).toBe(DEFAULT_SHORTCUTS.screenshot)
  })

  it('resets only the invalid fields instead of everything', () => {
    const stored = {
      settingsVersion: SETTINGS_VERSION,
      saveDir: 'relative/folder',
      fps: 60,
      resolution: '720p',
      noiseSuppression: false,
      countdownSeconds: 7,
      shortcuts: { startStop: 'Alt+F9', pauseResume: '' }
    }
    const result = migrateSettings(stored, defaults)
    expect(result.reset.sort()).toEqual(
      ['countdownSeconds', 'resolution', 'saveDir', 'shortcuts.pauseResume'].sort()
    )
    expect(result.settings.saveDir).toBe(defaults.saveDir)
    expect(result.settings.resolution).toBe('1080p')
    expect(result.settings.countdownSeconds).toBe(3)
    expect(result.settings.fps).toBe(60)
    expect(result.settings.noiseSuppression).toBe(false)
    expect(result.settings.shortcuts.startStop).toBe('Alt+F9')
    expect(result.settings.shortcuts.pauseResume).toBe(DEFAULT_SHORTCUTS.pauseResume)
    expect(result.shouldWrite).toBe(true)
  })

  it('does not rewrite current, valid settings', () => {
    const result = migrateSettings({ ...defaults, settingsVersion: SETTINGS_VERSION }, defaults)
    expect(result.shouldWrite).toBe(false)
    expect(result.settings).toEqual(defaults)
  })

  it('reads but never rewrites settings from a newer version', () => {
    const result = migrateSettings({ ...defaults, fps: 'x', settingsVersion: 99 }, defaults)
    expect(result.settings.fps).toBe(30)
    expect(result.shouldWrite).toBe(false)
  })

  it('falls back to defaults for a missing or damaged store', () => {
    expect(migrateSettings(undefined, defaults).settings).toEqual(defaults)
    expect(migrateSettings('garbage', defaults).settings).toEqual(defaults)
    expect(migrateSettings({ shortcuts: 'x', audioDeviceId: '' }, defaults).settings).toEqual(
      defaults
    )
  })
})

describe('disk space thresholds', () => {
  it('classifies free space', () => {
    expect(diskSpaceLevel(DISK_LOW_BYTES)).toBe('ok')
    expect(diskSpaceLevel(DISK_LOW_BYTES - 1)).toBe('low')
    expect(diskSpaceLevel(DISK_CRITICAL_BYTES)).toBe('low')
    expect(diskSpaceLevel(DISK_CRITICAL_BYTES - 1)).toBe('critical')
    expect(diskSpaceLevel(0)).toBe('critical')
  })

  it('reports each worsening level once and stops cleanly', async () => {
    vi.useFakeTimers()
    try {
      const readings = [
        DISK_LOW_BYTES * 2,
        DISK_LOW_BYTES - 1,
        DISK_LOW_BYTES - 2,
        DISK_CRITICAL_BYTES - 1,
        0
      ]
      const freeBytes = vi.fn(async () => readings.shift() ?? 0)
      const onStatus = vi.fn()
      const stop = startDiskMonitor('/x', onStatus, { intervalMs: 1000, freeBytes })
      await vi.advanceTimersByTimeAsync(5000)
      expect(onStatus.mock.calls.map(([status]) => status.level)).toEqual(['low', 'critical'])
      stop()
      stop()
      const calls = freeBytes.mock.calls.length
      await vi.advanceTimersByTimeAsync(5000)
      expect(freeBytes.mock.calls.length).toBe(calls)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a failing free space check', async () => {
    vi.useFakeTimers()
    try {
      const onStatus = vi.fn()
      const stop = startDiskMonitor('/x', onStatus, {
        intervalMs: 1000,
        freeBytes: async () => {
          throw new Error('statfs failed')
        }
      })
      await vi.advanceTimersByTimeAsync(3000)
      expect(onStatus).not.toHaveBeenCalled()
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
