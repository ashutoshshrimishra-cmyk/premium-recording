const MAX_PART_BYTES = 4 * 1024 * 1024
const MAX_QUEUED_BYTES = 64 * 1024 * 1024

export class RecordingChunkWriter {
  private pendingWrites = Promise.resolve()
  private failure: Error | undefined
  private queuedBytes = 0

  constructor(
    private readonly writeChunk: (chunk: ArrayBuffer) => Promise<boolean>,
    private readonly onError: (error: Error) => void
  ) {}

  enqueue(blob: Blob): void {
    if (blob.size === 0 || this.failure) return
    if (this.queuedBytes + blob.size > MAX_QUEUED_BYTES) {
      this.fail(new Error('Recording stopped because disk writes could not keep up'))
      return
    }

    for (let offset = 0; offset < blob.size; offset += MAX_PART_BYTES) {
      this.enqueuePart(blob.slice(offset, Math.min(blob.size, offset + MAX_PART_BYTES)))
    }
  }

  private enqueuePart(blob: Blob): void {
    this.queuedBytes += blob.size
    this.pendingWrites = this.pendingWrites
      .then(async () => {
        try {
          if (this.failure) return
          const written = await this.writeChunk(await blob.arrayBuffer())
          if (!written) throw new Error('Recording chunk was not written')
        } finally {
          this.queuedBytes -= blob.size
        }
      })
      .catch((error: unknown) => {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      })
  }

  private fail(error: Error): void {
    if (this.failure) return
    this.failure = error
    this.onError(error)
  }

  async flush(): Promise<void> {
    await this.pendingWrites
    if (this.failure) throw this.failure
  }
}
