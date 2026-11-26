export type PanelDock = 'right' | 'left' | 'top' | 'bottom'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayLike {
  id: number
  bounds: Rect
  workArea: Rect
}

export const PANEL_MARGIN = 12
export const PANEL_TOOLS_WIDTH = 84
export const PANEL_EXPANDED_WIDTH = 280
export const PANEL_MAX_HEIGHT = 780
export const PANEL_HORIZONTAL_MAX_WIDTH = 960
export const PANEL_HORIZONTAL_HEIGHT = 132

const clamp = (value: number, min: number, max: number): number =>
  Math.round(Math.min(Math.max(value, min), Math.max(min, max)))

/**
 * Finds the display that is being recorded. Tries the exact display id, then the index of a
 * 'screen:N:0' source id, then the primary display. Only returns undefined without any display.
 */
export function resolveDisplay<T extends { id: number }>(
  sourceDisplayId: string,
  sourceId: string,
  displays: readonly T[],
  primary: T | undefined
): T | undefined {
  if (sourceDisplayId) {
    const exact = displays.find((display) => String(display.id) === sourceDisplayId)
    if (exact) return exact
  }
  const match = /^screen:(\d+):/.exec(sourceId)
  if (match) {
    const byIndex = displays[Number(match[1])]
    if (byIndex) return byIndex
  }
  return primary ?? displays[0]
}

/** Panel size for a dock. Vertical docks are narrow and tall, horizontal docks are wide and short. */
export function panelSize(dock: PanelDock, expanded: boolean, workArea: Rect): Rect {
  if (dock === 'left' || dock === 'right') {
    return {
      x: 0,
      y: 0,
      width: expanded ? PANEL_EXPANDED_WIDTH : PANEL_TOOLS_WIDTH,
      height: Math.min(PANEL_MAX_HEIGHT, workArea.height - PANEL_MARGIN * 2)
    }
  }
  return {
    x: 0,
    y: 0,
    width: Math.min(PANEL_HORIZONTAL_MAX_WIDTH, workArea.width - PANEL_MARGIN * 2),
    height: PANEL_HORIZONTAL_HEIGHT
  }
}

/** Bounds of a panel docked to one edge of the work area, centered on the other axis. */
export function dockBounds(
  workArea: Rect,
  dock: PanelDock,
  size: { width: number; height: number }
): Rect {
  const width = Math.min(size.width, workArea.width)
  const height = Math.min(size.height, workArea.height)
  let x: number
  let y: number
  if (dock === 'right') {
    x = workArea.x + workArea.width - width - PANEL_MARGIN
    y = workArea.y + (workArea.height - height) / 2
  } else if (dock === 'left') {
    x = workArea.x + PANEL_MARGIN
    y = workArea.y + (workArea.height - height) / 2
  } else if (dock === 'top') {
    x = workArea.x + (workArea.width - width) / 2
    y = workArea.y + PANEL_MARGIN
  } else {
    x = workArea.x + (workArea.width - width) / 2
    y = workArea.y + workArea.height - height - PANEL_MARGIN
  }
  return {
    x: clamp(x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(y, workArea.y, workArea.y + workArea.height - height),
    width,
    height
  }
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** Moves and shrinks bounds so they lie fully inside the work area that they overlap the most. */
export function clampToDisplays(bounds: Rect, workAreas: readonly Rect[]): Rect {
  if (workAreas.length === 0) return bounds
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const distance = (area: Rect): number => {
    const dx = Math.max(area.x - centerX, 0, centerX - (area.x + area.width))
    const dy = Math.max(area.y - centerY, 0, centerY - (area.y + area.height))
    return dx * dx + dy * dy
  }
  // The display with the largest overlap wins, otherwise the closest one.
  let best = workAreas[0]
  let bestOverlap = -1
  let bestDistance = Infinity
  for (const area of workAreas) {
    const overlap = overlapArea(bounds, area)
    const gap = distance(area)
    if (overlap > bestOverlap || (overlap === bestOverlap && gap < bestDistance)) {
      best = area
      bestOverlap = overlap
      bestDistance = gap
    }
  }
  const width = Math.min(bounds.width, best.width)
  const height = Math.min(bounds.height, best.height)
  return {
    x: clamp(bounds.x, best.x, best.x + best.width - width),
    y: clamp(bounds.y, best.y, best.y + best.height - height),
    width,
    height
  }
}

/** Changes the panel width when it expands or collapses while the docked edge stays in place. */
export function resizeKeepingEdge(bounds: Rect, width: number, dock: PanelDock): Rect {
  const x = dock === 'right' ? bounds.x + bounds.width - width : bounds.x
  return { ...bounds, x, width }
}
