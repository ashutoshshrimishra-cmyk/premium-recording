import type { OverlayShape, OverlayStamp } from '../../../shared/ipc-schemas'

export const COLORS = ['#ff3b5c', '#ffb020', '#f8e71c', '#35d07f', '#3b82f6', '#a78bfa', '#ffffff']
export const WIDTHS = [2, 4, 6, 10]
export const FONT_SIZES: ReadonlyArray<{ size: number; label: string }> = [
  { size: 20, label: 'S' },
  { size: 28, label: 'M' },
  { size: 40, label: 'L' },
  { size: 64, label: 'XL' }
]

export const DEFAULT_SHAPE: OverlayShape = 'pen'
export const DEFAULT_STAMP: OverlayStamp = 'check'
export const DEFAULT_COLOR = COLORS[0]
export const DEFAULT_WIDTH = 4
export const DEFAULT_FONT_SIZE = 28

export const TEXT_FONT_FAMILY = '"Segoe UI", system-ui, -apple-system, sans-serif'
