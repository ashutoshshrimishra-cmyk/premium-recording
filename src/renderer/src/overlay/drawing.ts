import { STAMP_SIZE, annotationBounds, type Annotation, type Point } from './annotationModel'
import { TEXT_FONT_FAMILY } from './options'

export type DraftAnnotation = Omit<Annotation, 'id'>

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const radius = Math.min(16, width / 4, height / 4)
  context.beginPath()
  context.moveTo(x + radius, y)
  context.lineTo(x + width - radius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + radius)
  context.lineTo(x + width, y + height - radius)
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  context.lineTo(x + radius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - radius)
  context.lineTo(x, y + radius)
  context.quadraticCurveTo(x, y, x + radius, y)
  context.closePath()
}

function drawArrowhead(
  context: CanvasRenderingContext2D,
  from: Point,
  tip: Point,
  width: number
): void {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x)
  const length = Math.max(10, width * 3)
  const spread = Math.PI / 7

  context.moveTo(
    tip.x - length * Math.cos(angle - spread),
    tip.y - length * Math.sin(angle - spread)
  )
  context.lineTo(tip.x, tip.y)
  context.lineTo(
    tip.x - length * Math.cos(angle + spread),
    tip.y - length * Math.sin(angle + spread)
  )
}

export function textFont(fontSize: number): string {
  return `600 ${fontSize}px ${TEXT_FONT_FAMILY}`
}

export function measureText(
  context: CanvasRenderingContext2D,
  text: string,
  fontSize: number
): number {
  context.save()
  context.font = textFont(fontSize)
  const width = context.measureText(text).width
  context.restore()
  return width
}

function drawStamp(context: CanvasRenderingContext2D, annotation: DraftAnnotation): void {
  const center = annotation.points[0]
  if (!center) return
  const half = STAMP_SIZE / 2
  context.translate(center.x, center.y)
  context.lineWidth = Math.max(6, annotation.width * 1.5)
  context.beginPath()
  switch (annotation.stamp) {
    case 'check':
      context.moveTo(-half * 0.75, 0)
      context.lineTo(-half * 0.2, half * 0.55)
      context.lineTo(half * 0.8, -half * 0.6)
      context.stroke()
      break
    case 'cross':
      context.moveTo(-half * 0.6, -half * 0.6)
      context.lineTo(half * 0.6, half * 0.6)
      context.moveTo(half * 0.6, -half * 0.6)
      context.lineTo(-half * 0.6, half * 0.6)
      context.stroke()
      break
    case 'star': {
      for (let i = 0; i < 10; i += 1) {
        const radius = i % 2 === 0 ? half : half * 0.42
        const angle = -Math.PI / 2 + (i * Math.PI) / 5
        const x = radius * Math.cos(angle)
        const y = radius * Math.sin(angle)
        if (i === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.closePath()
      context.fill()
      break
    }
    case 'heart': {
      const s = half / 16
      context.moveTo(0, 14 * s)
      context.bezierCurveTo(-22 * s, -2 * s, -14 * s, -16 * s, 0, -6 * s)
      context.bezierCurveTo(14 * s, -16 * s, 22 * s, -2 * s, 0, 14 * s)
      context.closePath()
      context.fill()
      break
    }
    case 'question':
      context.font = `800 ${STAMP_SIZE}px ${TEXT_FONT_FAMILY}`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText('?', 0, 2)
      break
    case 'arrow':
      context.moveTo(-half * 0.8, 0)
      context.lineTo(half * 0.8, 0)
      drawArrowhead(context, { x: -half, y: 0 }, { x: half * 0.85, y: 0 }, 6)
      context.stroke()
      break
  }
}

export function drawAnnotation(
  context: CanvasRenderingContext2D,
  annotation: DraftAnnotation
): void {
  const { points } = annotation
  if (points.length === 0) return

  context.save()
  context.strokeStyle = annotation.color
  context.fillStyle = annotation.color
  context.lineWidth = annotation.width
  context.lineCap = 'round'
  context.lineJoin = 'round'

  if (annotation.tool === 'text') {
    if (annotation.text) {
      context.font = textFont(annotation.fontSize ?? 28)
      context.textBaseline = 'top'
      context.shadowColor = 'rgb(0 0 0 / 45%)'
      context.shadowBlur = 3
      context.fillText(
        annotation.text,
        points[0].x,
        points[0].y + (annotation.fontSize ?? 28) * 0.1
      )
    }
    context.restore()
    return
  }

  if (annotation.tool === 'stamp') {
    drawStamp(context, annotation)
    context.restore()
    return
  }

  if (annotation.tool === 'pen') {
    if (points.length === 1) {
      context.beginPath()
      context.arc(points[0].x, points[0].y, annotation.width / 2, 0, Math.PI * 2)
      context.fill()
    } else {
      context.beginPath()
      context.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) context.lineTo(points[i].x, points[i].y)
      context.stroke()
    }
    context.restore()
    return
  }

  if (points.length < 2) {
    context.restore()
    return
  }

  const [start, end] = points
  const left = Math.min(start.x, end.x)
  const top = Math.min(start.y, end.y)
  const width = Math.abs(end.x - start.x)
  const height = Math.abs(end.y - start.y)

  context.beginPath()
  switch (annotation.tool) {
    case 'line':
      context.moveTo(start.x, start.y)
      context.lineTo(end.x, end.y)
      break
    case 'arrow':
      context.moveTo(start.x, start.y)
      context.lineTo(end.x, end.y)
      drawArrowhead(context, start, end, annotation.width)
      break
    case 'doubleArrow':
      context.moveTo(start.x, start.y)
      context.lineTo(end.x, end.y)
      drawArrowhead(context, start, end, annotation.width)
      drawArrowhead(context, end, start, annotation.width)
      break
    case 'rect':
      context.rect(left, top, width, height)
      break
    case 'roundRect':
      roundedRectPath(context, left, top, width, height)
      break
    case 'ellipse':
      context.ellipse(
        (start.x + end.x) / 2,
        (start.y + end.y) / 2,
        width / 2,
        height / 2,
        0,
        0,
        Math.PI * 2
      )
      break
  }
  context.stroke()
  context.restore()
}

/** Dashed outline around the selected annotation. */
export function drawSelection(context: CanvasRenderingContext2D, annotation: Annotation): void {
  const box = annotationBounds(annotation)
  context.save()
  context.strokeStyle = '#7c8cff'
  context.lineWidth = 1.5
  context.setLineDash([6, 4])
  context.strokeRect(box.x - 4, box.y - 4, box.width + 8, box.height + 8)
  context.restore()
}

/** Dims the whole screen except a soft circle around the cursor. */
export function drawSpotlight(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  center: Point | undefined,
  radius = 130
): void {
  context.save()
  context.fillStyle = 'rgb(0 0 0 / 62%)'
  if (!center) {
    context.fillRect(0, 0, width, height)
    context.restore()
    return
  }
  context.beginPath()
  context.rect(0, 0, width, height)
  context.arc(center.x, center.y, radius, 0, Math.PI * 2, true)
  context.fill('evenodd')
  context.restore()
}
