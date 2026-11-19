import { describe, expect, it, vi } from 'vitest'
import { RecordingChunkWriter } from '../src/renderer/src/recorder/chunkWriter'

describe('RecordingChunkWriter', () => {
  it('waits for queued chunk writes before flushing', async () => {
    let announceWriteStarted: () => void = () => {}
    let resolveWrite: (written: boolean) => void = () => {}
    const writeStarted = new Promise<void>((resolve) => {
      announceWriteStarted = resolve
    })
    const writer = new RecordingChunkWriter(
      async () => {
        announceWriteStarted()
        return new Promise<boolean>((resolve) => {
          resolveWrite = resolve
        })
      },
      () => {}
    )

    writer.enqueue(new Blob(['recording chunk']))
    let flushed = false
    const flush = writer.flush().then(() => {
      flushed = true
    })

    await writeStarted
    expect(flushed).toBe(false)
    resolveWrite(true)
    await flush
    expect(flushed).toBe(true)
  })

  it('reports a rejected write and fails flush instead of treating it as success', async () => {
    const onError = vi.fn()
    const writer = new RecordingChunkWriter(async () => false, onError)
    writer.enqueue(new Blob(['recording chunk']))

    await expect(writer.flush()).rejects.toThrow('Recording chunk was not written')
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })
})
