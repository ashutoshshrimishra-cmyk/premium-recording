import { describe, expect, it } from 'vitest'
import {
  addRecent,
  formatBytes,
  formatDuration,
  pruneMissing,
  type RecentRecordingEntry
} from '../src/shared/recentRecordings'

const entry = (name: string): RecentRecordingEntry => ({
  filePath: `C:\\Videos\\${name}.mp4`,
  sizeBytes: 1000,
  durationMs: 5000,
  savedAt: '2026-01-01T00:00:00.000Z'
})

describe('recent recordings', () => {
  it('puts the newest first', () => {
    const list = addRecent([entry('a')], entry('b'))
    expect(list.map((item) => item.filePath)).toEqual([entry('b').filePath, entry('a').filePath])
  })

  it('keeps at most 10 entries', () => {
    let list: RecentRecordingEntry[] = []
    for (let index = 0; index < 15; index++) list = addRecent(list, entry(String(index)))
    expect(list).toHaveLength(10)
    expect(list[0].filePath).toBe(entry('14').filePath)
    expect(list[9].filePath).toBe(entry('5').filePath)
  })

  it('replaces an older entry for the same file', () => {
    const list = addRecent([entry('a'), entry('b')], { ...entry('A'), sizeBytes: 5 })
    expect(list).toHaveLength(2)
    expect(list[0].sizeBytes).toBe(5)
  })

  it('drops files that no longer exist', () => {
    const list = pruneMissing([entry('a'), entry('b')], (path) => path.includes('b'))
    expect(list.map((item) => item.filePath)).toEqual([entry('b').filePath])
  })

  it('formats size and duration', () => {
    expect(formatBytes(500)).toBe('1 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatDuration(65_000)).toBe('01:05')
    expect(formatDuration(3_725_000)).toBe('1:02:05')
  })
})
