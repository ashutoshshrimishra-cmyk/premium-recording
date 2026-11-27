import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { WriteStream } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendRecordingChunk,
  closeActiveRecordingKeepingPart,
  closeStream,
  discardActiveRecording,
  finalizeWithoutOverwrite,
  getActiveTempPath,
  MAX_NAME_ATTEMPTS,
  startRecordingFile,
  stopRecordingFile
} from '../src/main/recording'
import {
  describeWriteError,
  RECORDING_CANCELLED,
  RECORDING_EMPTY,
  toStopFailure
} from '../src/main/recordingErrors'
import { isStartupCancelled, once, ownerLossTeardown } from '../src/main/ipc/sessionState'
import { ipcErrorMessage } from '../src/renderer/src/recorder/ipcError'
import { captureEndedMessage } from '../src/renderer/src/recorder/trackEvents'

let dir = ''
afterEach(async () => {
  await discardActiveRecording()
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ''
})

const errno = (code: string): Error => Object.assign(new Error(`${code}: simulated`), { code })

describe('session teardown decisions', () => {
  it('discards while starting, keeps the .part while recording, leaves stopping to stop', () => {
    expect(ownerLossTeardown('starting')).toBe('discard')
    expect(ownerLossTeardown('recording')).toBe('keep')
    expect(ownerLossTeardown('stopping')).toBe('none')
  })

  it('treats a torn down, replaced or missing session as a cancelled startup', () => {
    expect(isStartupCancelled({ id: 'a', tornDown: false }, 'a')).toBe(false)
    expect(isStartupCancelled({ id: 'a', tornDown: true }, 'a')).toBe(true)
    expect(isStartupCancelled({ id: 'b', tornDown: false }, 'a')).toBe(true)
    expect(isStartupCancelled(undefined, 'a')).toBe(true)
  })

  it('runs the teardown once and returns the same promise to every caller', async () => {
    const run = vi.fn(async () => undefined)
    const teardown = once(run, () => undefined)
    const first = teardown()
    const second = teardown()
    expect(second).toBe(first)
    await Promise.all([first, second, teardown()])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('reports a failing teardown without rejecting', async () => {
    const onError = vi.fn()
    const teardown = once(async () => {
      throw new Error('boom')
    }, onError)
    await expect(teardown()).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }))
  })
})

describe('stop error payloads', () => {
  it('maps cancel and empty codes', () => {
    const cancelled = Object.assign(new Error('Recording was cancelled'), {
      code: RECORDING_CANCELLED
    })
    expect(toStopFailure(cancelled)).toEqual({
      ok: false,
      code: 'cancelled',
      message: 'Recording was cancelled'
    })
    expect(toStopFailure(Object.assign(new Error('0 bytes'), { code: RECORDING_EMPTY })).code).toBe(
      'empty'
    )
  })

  it('keeps the preserved path for save failures', () => {
    const error = Object.assign(new Error('kept at C:\\a.mp4.part'), {
      preservedPath: 'C:\\a.mp4.part'
    })
    expect(toStopFailure(error)).toEqual({
      ok: false,
      code: 'save-failed',
      message: 'kept at C:\\a.mp4.part',
      preservedPath: 'C:\\a.mp4.part'
    })
  })

  it('falls back to a generic code and bounds the message', () => {
    const failure = toStopFailure(new Error('x'.repeat(5000)))
    expect(failure.code).toBe('error')
    expect(failure.message.length).toBe(1000)
    expect(toStopFailure('plain').message).toBe('plain')
  })

  it('names disk full and other write errors', () => {
    expect(describeWriteError(errno('ENOSPC'))).toMatch(/^Disk full/)
    expect(describeWriteError(errno('EDQUOT'))).toMatch(/^Disk full/)
    expect(describeWriteError(errno('EACCES'))).toMatch(/permission denied/)
    expect(describeWriteError(errno('EIO'))).toMatch(/I\/O error/)
    expect(describeWriteError(errno('ENOENT'))).toMatch(/no longer available/)
    expect(describeWriteError(new Error('odd'))).toBe('Write failed: odd')
  })
})

describe('renderer error text', () => {
  it('strips the Electron invoke prefix', () => {
    expect(
      ipcErrorMessage(new Error("Error invoking remote method 'recording-start': Error: Disk full"))
    ).toBe('Disk full')
    expect(ipcErrorMessage(new Error('plain reason'))).toBe('plain reason')
    expect(ipcErrorMessage(undefined, 'fallback')).toBe('fallback')
  })

  it('names what ended when the video track stops', () => {
    expect(captureEndedMessage('window')).toMatch(/window was closed/)
    expect(captureEndedMessage('screen')).toMatch(/screen was disconnected/)
    expect(captureEndedMessage('unknown')).toMatch(/ended unexpectedly/)
  })
})

describe('recording file lifecycle', () => {
  it('stops waiting for a stream that never closes', async () => {
    vi.useFakeTimers()
    try {
      const fake = Object.assign(new EventEmitter(), {
        closed: false,
        writableEnded: false,
        end: vi.fn(),
        destroy: vi.fn()
      })
      const waiting = closeStream(fake as unknown as WriteStream, 1000)
      const assertion = expect(waiting).rejects.toThrow(/did not close within 1 s/)
      await vi.advanceTimersByTimeAsync(1000)
      await assertion
      expect(fake.destroy).toHaveBeenCalled()
      expect(fake.listenerCount('close')).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects chunks with a clear message when no file is open', async () => {
    await expect(appendRecordingChunk(new Uint8Array([1]))).rejects.toThrow(
      /recording file is no longer open/
    )
  })

  it('keeps the .part with its data when closed for recovery', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rec-keep-'))
    await startRecordingFile(dir, new Date(2026, 0, 1, 1, 2, 3), 'video/webm')
    const tempPath = getActiveTempPath() as string
    await appendRecordingChunk(new TextEncoder().encode('data'))
    await closeActiveRecordingKeepingPart(tempPath)
    expect(getActiveTempPath()).toBeUndefined()
    expect(await readFile(tempPath, 'utf8')).toBe('data')
  })

  it('removes an empty .part instead of keeping it', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rec-keep-empty-'))
    await startRecordingFile(dir, new Date(2026, 0, 1, 1, 2, 3))
    await closeActiveRecordingKeepingPart()
    expect(await readdir(dir)).toHaveLength(0)
  })

  it('only discards the recording it was asked to discard', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rec-discard-'))
    await startRecordingFile(dir, new Date(2026, 0, 1, 1, 2, 3))
    await discardActiveRecording(join(dir, 'other.mp4.part'))
    expect(getActiveTempPath()).toBeDefined()
    await appendRecordingChunk(new TextEncoder().encode('x'))
    const saved = await stopRecordingFile('video/mp4')
    expect(await readFile(saved, 'utf8')).toBe('x')
  })

  it('gives up finding a free name after a bounded number of attempts', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rec-names-'))
    const temp = join(dir, 'a.mp4.part')
    await writeFile(temp, 'x')
    await writeFile(join(dir, 'a.mp4'), 'taken')
    for (let n = 2; n <= MAX_NAME_ATTEMPTS; n += 1) await writeFile(join(dir, `a_${n}.mp4`), 't')
    await expect(finalizeWithoutOverwrite(temp, join(dir, 'a.mp4'))).rejects.toThrow(/unique/)
    expect(await readFile(temp, 'utf8')).toBe('x')
  })
})
