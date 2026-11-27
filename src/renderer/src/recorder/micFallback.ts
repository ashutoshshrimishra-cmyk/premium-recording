export type MicFailureKind = 'denied' | 'not-found' | 'in-use' | 'other'

export interface MicFailure {
  kind: MicFailureKind
  message: string
}

export type MicChoice = 'retry' | 'video-only' | 'cancel'

export function classifyMicFailure(error: unknown): MicFailure {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      kind: 'denied',
      message: 'Microphone access was denied. Allow microphone access for this app in Windows.'
    }
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return {
      kind: 'not-found',
      message: 'The selected microphone was not found. It may be unplugged or disabled.'
    }
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return {
      kind: 'in-use',
      message: 'The microphone could not be opened. Another app may be using it.'
    }
  }
  const detail = error instanceof Error ? error.message : String(error)
  return { kind: 'other', message: `Could not use the selected microphone: ${detail}` }
}

export async function openMicrophoneWithFallback<T>(
  open: () => Promise<T>,
  askUser: (failure: MicFailure) => Promise<MicChoice>,
  isCancelled: () => boolean
): Promise<{ microphone?: T; videoOnly: boolean }> {
  for (;;) {
    try {
      return { microphone: await open(), videoOnly: false }
    } catch (error) {
      const choice = await askUser(classifyMicFailure(error))
      if (choice === 'cancel' || isCancelled()) throw new Error('Recording was cancelled', { cause: error })
      if (choice === 'video-only') return { videoOnly: true }
    }
  }
}

export function shouldDiscardOnWriteError(): boolean {
  return false
}

export function chunkWriteFailureMessage(error: Error, savedPath?: string): string {
  return savedPath
    ? `Chunk write failed: ${error.message}. The partial recording was kept at ${savedPath}`
    : `Chunk write failed: ${error.message}. Any data already written was kept.`
}
