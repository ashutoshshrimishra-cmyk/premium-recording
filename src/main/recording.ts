import { access, mkdir, statfs, rename, stat, unlink } from 'node:fs/promises'
import { constants, createWriteStream, type WriteStream } from 'node:fs'
import { join, resolve } from 'node:path'

let selectedSourceId = ''
let activeStream: WriteStream | undefined
let activeFilePath: string | undefined
let streamError: Error | undefined

export function setSelectedSourceId(sourceId: string): void {
  selectedSourceId = sourceId
}

export function getSelectedSourceId(): string {
  return selectedSourceId
}

export function generateRecordingFilename(now = new Date(), mimeType = 'video/mp4'): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  const extension = mimeType.toLowerCase().includes('webm') ? 'webm' : 'mp4'
  return `Recording_${date}_${time}.${extension}`
}

export async function checkRecordingDestination(
  saveDir: string,
  minimumBytes = 100 * 1024 * 1024
): Promise<string> {
  const directory = resolve(saveDir)
  await mkdir(directory, { recursive: true })
  await access(directory, constants.W_OK)
  const stats = await statfs(directory)
  if (!hasEnoughDiskSpace(stats.bavail * stats.bsize, minimumBytes)) {
    throw new Error('Disk full: less than 100 MB is available')
  }
  return directory
}

export function hasEnoughDiskSpace(
  availableBytes: number,
  minimumBytes = 100 * 1024 * 1024
): boolean {
  return availableBytes >= minimumBytes
}

export async function startRecordingFile(
  saveDir: string,
  now = new Date(),
  mimeType = 'video/mp4'
): Promise<string> {
  const directory = await checkRecordingDestination(saveDir)
  const mp4Path = join(directory, generateRecordingFilename(now, mimeType))
  activeFilePath = mp4Path
  streamError = undefined
  activeStream = createWriteStream(mp4Path, { flags: 'w' })
  activeStream.on('error', (error) => {
    streamError = error instanceof Error ? error : new Error(String(error))
  })
  await new Promise<void>((resolveReady, reject) => {
    activeStream!.once('open', () => resolveReady())
    activeStream!.once('error', reject)
  })
  return mp4Path
}

export function appendRecordingChunk(chunk: ArrayBuffer | ArrayBufferView): Promise<boolean> {
  const stream = activeStream
  if (!stream || stream.destroyed || streamError) return Promise.resolve(false)
  if (chunk.byteLength === 0) return Promise.resolve(true)
  const data = ArrayBuffer.isView(chunk)
    ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    : Buffer.from(chunk)

  return new Promise((resolveChunk, rejectChunk) => {
    stream.write(data, (error) => {
      if (error) {
        streamError = error
        rejectChunk(error)
        return
      }
      if (streamError) {
        rejectChunk(streamError)
        return
      }
      resolveChunk(true)
    })
  })
}

export async function stopRecordingFile(mimeType: string, discard = false): Promise<string> {
  if (!activeStream || !activeFilePath) throw new Error('No active recording')
  const stream = activeStream
  const startedPath = activeFilePath
  try {
    await new Promise<void>((resolveClosed, reject) => {
      stream.once('close', resolveClosed)
      stream.once('error', reject)
      stream.end()
    })
    if (streamError) throw streamError

    if (discard) {
      await unlink(startedPath).catch(() => undefined)
      throw new Error('Recording was cancelled')
    }

    // Never leave a silent 0-byte file behind: tell the user the capture produced nothing.
    const { size } = await stat(startedPath)
    if (size === 0) {
      await unlink(startedPath).catch(() => undefined)
      throw new Error('Recording produced no data (0 bytes). The screen capture did not deliver any video.')
    }

    const extension = mimeType.toLowerCase().includes('webm') ? 'webm' : 'mp4'
    const finalPath = startedPath.endsWith('.mp4')
      ? startedPath.slice(0, -4) + `.${extension}`
      : startedPath
    if (finalPath !== startedPath) await rename(startedPath, finalPath)
    return finalPath
  } finally {
    activeStream = undefined
    activeFilePath = undefined
    streamError = undefined
  }
}
