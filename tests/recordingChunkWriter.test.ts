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

describe('RecordingChunkWriter backpressure', () => {
  function gated(options: ConstructorParameters<typeof RecordingChunkWriter>[2]): {
    writer: RecordingChunkWriter
    onError: ReturnType<typeof vi.fn>
    drain: () => Promise<void>
  } {
    let open: () => void = () => {}
    let gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const onError = vi.fn()
    const writer = new RecordingChunkWriter(
      async () => {
        await gate
        return true
      },
      onError,
      options
    )
    const drain = async (): Promise<void> => {
      open()
      await writer.flush().catch(() => {})
      gate = new Promise<void>((resolve) => {
        open = resolve
      })
    }
    return { writer, onError, drain }
  }
  const opts = { warnQueuedBytes: 100, rearmQueuedBytes: 20, maxQueuedBytes: 300 }

  it('warns once when the soft threshold is crossed and tracks the peak', async () => {
    const onWarning = vi.fn()
    const { writer, drain } = gated({ ...opts, onWarning })
    writer.enqueue(new Blob([new Uint8Array(60)]))
    expect(onWarning).not.toHaveBeenCalled()
    writer.enqueue(new Blob([new Uint8Array(60)]))
    writer.enqueue(new Blob([new Uint8Array(60)]))
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(writer.peakQueuedBytes).toBe(180)
    await drain()
    await writer.flush()
  })

  it('re-arms after the queue drains', async () => {
    const onWarning = vi.fn()
    const { writer, drain } = gated({ ...opts, onWarning })
    writer.enqueue(new Blob([new Uint8Array(120)]))
    await drain()
    writer.enqueue(new Blob([new Uint8Array(120)]))
    expect(onWarning).toHaveBeenCalledTimes(2)
    await drain()
  })

  it('still fails at the hard cap and flush rethrows', async () => {
    const { writer, onError, drain } = gated(opts)
    writer.enqueue(new Blob([new Uint8Array(200)]))
    writer.enqueue(new Blob([new Uint8Array(200)]))
    expect(onError).toHaveBeenCalledTimes(1)
    await drain()
    await expect(writer.flush()).rejects.toThrow('disk writes could not keep up')
  })
})
