export class RecordingChunkWriter {
  private pendingWrites = Promise.resolve()
  private failure: Error | undefined

  constructor(
    private readonly writeChunk: (chunk: ArrayBuffer) => Promise<boolean>,
    private readonly onError: (error: Error) => void
  ) {}

  enqueue(blob: Blob): void {
    if (blob.size === 0 || this.failure) return

    this.pendingWrites = this.pendingWrites
      .then(async () => {
        if (this.failure) return
        const written = await this.writeChunk(await blob.arrayBuffer())
        if (!written) throw new Error('Recording chunk was not written')
      })
      .catch((error: unknown) => {
        this.failure = error instanceof Error ? error : new Error(String(error))
        this.onError(this.failure)
      })
  }

  async flush(): Promise<void> {
    await this.pendingWrites
    if (this.failure) throw this.failure
  }
}
