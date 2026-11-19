import { access, mkdir, statfs, rename } from 'node:fs/promises'
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

export async function startRecordingFile(saveDir: string, now = new Date()): Promise<string> {
  const directory = await checkRecordingDestination(saveDir)
  const mp4Path = join(directory, generateRecordingFilename(now, 'video/mp4'))
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

export function appendRecordingChunk(chunk: ArrayBuffer): boolean {
  if (!activeStream || activeStream.destroyed || streamError) return false
  activeStream.write(Buffer.from(chunk))
  return !activeStream.destroyed
}

export async function stopRecordingFile(mimeType: string): Promise<string> {
  if (!activeStream || !activeFilePath) throw new Error('No active recording')
  const stream = activeStream
  await new Promise<void>((resolveClosed, reject) => {
    stream.once('close', resolveClosed)
    stream.once('error', reject)
    stream.end()
  })
  if (streamError) throw streamError

  const extension = mimeType.toLowerCase().includes('webm') ? 'webm' : 'mp4'
  const finalPath = activeFilePath.endsWith('.mp4')
    ? activeFilePath.slice(0, -4) + `.${extension}`
    : activeFilePath
  if (finalPath !== activeFilePath) await rename(activeFilePath, finalPath)

  activeStream = undefined
  activeFilePath = undefined
  streamError = undefined
  return finalPath
}
