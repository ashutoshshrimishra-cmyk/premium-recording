import type { ActiveRipple, CursorEffectSettings, Position } from './cursorEffect'

export interface CursorLayerFrame {
  settings: CursorEffectSettings
  position: Position | undefined
  ripples: ActiveRipple[]
}

function drawPointerArrow(context: CanvasRenderingContext2D, x: number, y: number): void {
  context.save()
  context.translate(x, y)
  context.beginPath()
  context.moveTo(0, 0)
  context.lineTo(0, 17)
  context.lineTo(4.5, 13)
  context.lineTo(7.5, 20)
  context.lineTo(10, 19)
  context.lineTo(7, 12)
  context.lineTo(13, 12)
  context.closePath()
  context.fillStyle = '#ffffff'
  context.strokeStyle = '#111111'
  context.lineWidth = 1.5
  context.lineJoin = 'round'
  context.fill()
  context.stroke()
  context.restore()
}

/** Draws the halo, click ripples and optional pointer. Ripples are drawn even outside the display. */
export function drawCursorLayer(context: CanvasRenderingContext2D, frame: CursorLayerFrame): void {
  const { settings, position, ripples } = frame
  if (settings.highlight && position) {
    context.beginPath()
    context.arc(position.x, position.y, settings.radius, 0, Math.PI * 2)
    context.fillStyle = settings.highlightColor
    context.fill()
  }
  if (settings.ripple) {
    for (const ripple of ripples) {
      const eased = 1 - Math.pow(1 - ripple.progress, 2)
      context.beginPath()
      context.arc(ripple.x, ripple.y, 8 + eased * settings.radius * 1.6, 0, Math.PI * 2)
      context.strokeStyle = `rgba(255, 90, 60, ${(1 - ripple.progress) * 0.9})`
      context.lineWidth = 4 * (1 - ripple.progress) + 1
      context.stroke()
    }
  }
  if (settings.drawPointer && position) drawPointerArrow(context, position.x, position.y)
}
