import { readdir, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { finalizeWithoutOverwrite } from './recording'

export interface AbandonedPart {
  partPath: string
  sizeBytes: number
  modifiedAt: string
  suggestedFinalPath: string
}

const PART_PATTERN = /^.+\.(?:mp4|webm)\.part$/i

/** True when partPath is a direct child .part recording file of saveDir. */
export function isRecoverablePartPath(saveDir: string, partPath: string): boolean {
  const resolved = resolve(partPath)
  return (
    resolve(dirname(resolved)) === resolve(saveDir) &&
    PART_PATTERN.test(basename(resolved)) &&
    resolved === partPath
  )
}

export async function listAbandonedParts(
  saveDir: string,
  activeTempPath?: string
): Promise<AbandonedPart[]> {
  const directory = resolve(saveDir)
  let names: string[]
  try {
    names = await readdir(directory)
  } catch {
    return []
  }
  const active = activeTempPath ? resolve(activeTempPath) : undefined
  const parts: AbandonedPart[] = []
  for (const name of names) {
    if (!PART_PATTERN.test(name)) continue
    const partPath = join(directory, name)
    if (active && resolve(partPath) === active) continue
    try {
      const info = await stat(partPath)
      if (!info.isFile()) continue
      parts.push({
        partPath,
        sizeBytes: info.size,
        modifiedAt: info.mtime.toISOString(),
        suggestedFinalPath: partPath.slice(0, -'.part'.length)
      })
    } catch {
      // The file vanished while scanning.
    }
  }
  return parts.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

/** Finalizes an abandoned .part to a unique name that never overwrites a file. */
export async function recoverPart(partPath: string): Promise<string> {
  const { size } = await stat(partPath)
  if (size === 0) {
    await unlink(partPath).catch(() => undefined)
    throw new Error('The partial recording was empty and has been removed')
  }
  return finalizeWithoutOverwrite(partPath, partPath.slice(0, -'.part'.length))
}

export async function deletePart(partPath: string): Promise<void> {
  await unlink(partPath)
}
