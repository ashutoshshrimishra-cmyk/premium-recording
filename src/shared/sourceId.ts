export type SourceKind = 'screen' | 'window'

/** Parses an Electron capture source id such as 'screen:1:0' or 'window:123456:0'. */
export function parseSourceId(id: string): { kind: SourceKind; index: number } | undefined {
  const match = /^(screen|window):(\d+)(?::\d+)?$/.exec(id)
  if (!match) return undefined
  return { kind: match[1] as SourceKind, index: Number(match[2]) }
}

export function sourceKindOf(id: string): SourceKind | undefined {
  return parseSourceId(id)?.kind
}

/** Readable monitor label, for example 'Display 2 (1920x1080)' or 'Display 1 (2560x1440) - Primary'. */
export function displayLabel(
  position: number,
  width: number,
  height: number,
  primary: boolean
): string {
  const base = `Display ${position} (${Math.round(width)}x${Math.round(height)})`
  return primary ? `${base} - Primary` : base
}

interface DisplayLike {
  id: number
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
}

/** Matches a screen source to a display by display_id, falling back to the source index. */
export function matchDisplay<T extends DisplayLike>(
  sourceDisplayId: string,
  sourceId: string,
  displays: readonly T[]
): T | undefined {
  if (sourceDisplayId) {
    const exact = displays.find((display) => String(display.id) === sourceDisplayId)
    if (exact) return exact
  }
  const parsed = parseSourceId(sourceId)
  if (parsed?.kind === 'screen') return displays[parsed.index]
  return undefined
}

/** Display order for the picker: primary first, then left to right, top to bottom. */
export function sortDisplays<T extends DisplayLike>(
  displays: readonly T[],
  primaryId: number
): T[] {
  return [...displays].sort((a, b) => {
    if (a.id === primaryId) return -1
    if (b.id === primaryId) return 1
    return a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y
  })
}
