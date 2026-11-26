import { access, copyFile, link, mkdir, open, stat, statfs, unlink } from 'node:fs/promises'
import { constants, type WriteStream } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'

let selectedSourceId = ''
let activeStream: WriteStream | undefined
let startingFile = false
let activeTempPath: string | undefined
let activeFinalPath: string | undefined
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

async function openUniqueRecording(
  directory: string,
  filename: string
): Promise<{ stream: WriteStream; finalPath: string; tempPath: string }> {
  const extension = extname(filename)
  const stem = basename(filename, extension)

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = attempt === 0 ? '' : `_${attempt + 1}`
    const finalPath = join(directory, `${stem}${suffix}${extension}`)
    const tempPath = `${finalPath}.part`
    try {
      await access(finalPath)
      continue
    } catch {
      // The desired final path is free. The exclusive .part open reserves this attempt.
    }
    try {
      const handle = await open(tempPath, 'wx')
      return { stream: handle.createWriteStream(), finalPath, tempPath }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }

  throw new Error('Could not create a unique recording filename')
}

export async function startRecordingFile(
  saveDir: string,
  now = new Date(),
  mimeType = 'video/mp4'
): Promise<string> {
  if (activeStream || startingFile) throw new Error('A recording is already in progress')
  startingFile = true

  try {
    const directory = await checkRecordingDestination(saveDir)
    const opened = await openUniqueRecording(directory, generateRecordingFilename(now, mimeType))
    activeStream = opened.stream
    activeTempPath = opened.tempPath
    activeFinalPath = opened.finalPath
    streamError = undefined
    activeStream.on('error', (error) => {
      streamError = error instanceof Error ? error : new Error(String(error))
    })
    return opened.finalPath
  } finally {
    startingFile = false
  }
}

export function appendRecordingChunk(chunk: ArrayBuffer | ArrayBufferView): Promise<boolean> {
  const stream = activeStream
  if (!stream || stream.destroyed || stream.closed || streamError) return Promise.resolve(false)
  if (chunk.byteLength === 0) return Promise.resolve(true)
  if (chunk.byteLength > 16 * 1024 * 1024) {
    return Promise.reject(new Error('Recording chunk exceeds 16 MB'))
  }
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

async function closeStream(stream: WriteStream): Promise<void> {
  if (stream.closed) return
  await new Promise<void>((resolveClosed, reject) => {
    const onClose = (): void => {
      cleanup()
      resolveClosed()
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const cleanup = (): void => {
      stream.removeListener('close', onClose)
      stream.removeListener('error', onError)
    }
    stream.once('close', onClose)
    stream.once('error', onError)
    if (!stream.writableEnded) stream.end()
  })
}

function clearActiveRecording(): void {
  activeStream = undefined
  activeTempPath = undefined
  activeFinalPath = undefined
  streamError = undefined
}

async function finalizeWithoutOverwrite(tempPath: string, desiredPath: string): Promise<string> {
  const extension = extname(desiredPath)
  const stem = desiredPath.slice(0, -extension.length)
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const finalPath = attempt === 0 ? desiredPath : `${stem}_${attempt + 1}${extension}`
    try {
      await link(tempPath, finalPath)
      await unlink(tempPath).catch(() => undefined)
      return finalPath
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') continue
      if (code === 'EPERM' || code === 'ENOSYS' || code === 'ENOTSUP') {
        try {
          await copyFile(tempPath, finalPath, constants.COPYFILE_EXCL)
          await unlink(tempPath).catch(() => undefined)
          return finalPath
        } catch (copyError) {
          if ((copyError as NodeJS.ErrnoException).code === 'EEXIST') continue
          throw copyError
        }
      }
      throw error
    }
  }
  throw new Error('Could not finalize a unique recording filename')
}

export async function stopRecordingFile(mimeType: string, discard = false): Promise<string> {
  if (!activeStream || !activeTempPath || !activeFinalPath) {
    throw new Error('No active recording')
  }
  const stream = activeStream
  const tempPath = activeTempPath
  const extension = mimeType.toLowerCase().includes('webm') ? '.webm' : '.mp4'
  const finalPath = activeFinalPath.replace(/\.(?:mp4|webm)$/i, extension)
  try {
    await closeStream(stream)
    if (streamError) throw streamError

    if (discard) {
      await unlink(tempPath).catch(() => undefined)
      throw new Error('Recording was cancelled')
    }

    const { size } = await stat(tempPath)
    if (size === 0) {
      await unlink(tempPath).catch(() => undefined)
      throw new Error('Recording produced no data (0 bytes). The screen capture did not deliver any video.')
    }

    return await finalizeWithoutOverwrite(tempPath, finalPath)
  } catch (error) {
    if (!discard) await unlink(tempPath).catch(() => undefined)
    throw error
  } finally {
    clearActiveRecording()
  }
}

export async function discardActiveRecording(): Promise<void> {
  const stream = activeStream
  const tempPath = activeTempPath
  if (!stream || !tempPath) return
  try {
    await closeStream(stream).catch(() => undefined)
    await unlink(tempPath).catch(() => undefined)
  } finally {
    clearActiveRecording()
    setSelectedSourceId('')
  }
}
