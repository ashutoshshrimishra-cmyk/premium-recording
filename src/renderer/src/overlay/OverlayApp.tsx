import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import {
  AnnotationStore,
  LaserTrail,
  type Annotation,
  type Point,
  type Tool
} from './annotationModel'

type ActiveTool = Tool | 'eraser' | 'laser'
type DraftAnnotation = Omit<Annotation, 'id'>

type OverlayApi = Window['api'] & {
  overlaySetInteractive(input: { interactive: boolean }): Promise<boolean>
  overlayRequestStop(): Promise<boolean>
  onOverlayInteractiveChanged(callback: (interactive: boolean) => void): () => void
}

const TOOLS: ReadonlyArray<{ tool: ActiveTool; label: string; glyph: string }> = [
  { tool: 'pen', label: 'Pen', glyph: '✎' },
  { tool: 'line', label: 'Line', glyph: '╱' },
  { tool: 'arrow', label: 'Arrow', glyph: '→' },
  { tool: 'doubleArrow', label: 'Double arrow', glyph: '↔' },
  { tool: 'rect', label: 'Rectangle', glyph: '□' },
  { tool: 'roundRect', label: 'Rounded rectangle', glyph: '▢' },
  { tool: 'ellipse', label: 'Ellipse', glyph: '○' },
  { tool: 'eraser', label: 'Eraser', glyph: '⌫' },
  { tool: 'laser', label: 'Laser pointer', glyph: '●' }
]

const COLORS = ['#ff3b5c', '#ffb020', '#f8e71c', '#35d07f', '#3b82f6', '#a78bfa', '#ffffff']
const WIDTHS = [2, 4, 6, 10]

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

  context.moveTo(tip.x - length * Math.cos(angle - spread), tip.y - length * Math.sin(angle - spread))
  context.lineTo(tip.x, tip.y)
  context.lineTo(tip.x - length * Math.cos(angle + spread), tip.y - length * Math.sin(angle + spread))
}

function drawAnnotation(context: CanvasRenderingContext2D, annotation: DraftAnnotation): void {
  const { points } = annotation
  if (points.length === 0) return

  context.save()
  context.strokeStyle = annotation.color
  context.fillStyle = annotation.color
  context.lineWidth = annotation.width
  context.lineCap = 'round'
  context.lineJoin = 'round'

  if (annotation.tool === 'pen') {
    if (points.length === 1) {
      context.beginPath()
      context.arc(points[0].x, points[0].y, annotation.width / 2, 0, Math.PI * 2)
      context.fill()
    } else {
      context.beginPath()
      context.moveTo(points[0].x, points[0].y)
      for (const point of points.slice(1)) context.lineTo(point.x, point.y)
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

function drawLaser(
  context: CanvasRenderingContext2D,
  points: Array<Point & { alpha: number }>,
  color: string,
  width: number
): void {
  if (points.length === 0) return

  const laserWidth = Math.max(3, width)
  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = laserWidth
  context.shadowColor = color
  context.shadowBlur = Math.max(10, laserWidth * 2)

  if (points.length === 1) {
    context.globalAlpha = points[0].alpha
    context.fillStyle = color
    context.beginPath()
    context.arc(points[0].x, points[0].y, laserWidth / 1.5, 0, Math.PI * 2)
    context.fill()
  } else {
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1]
      const point = points[index]
      context.globalAlpha = (previous.alpha + point.alpha) / 2
      context.strokeStyle = color
      context.beginPath()
      context.moveTo(previous.x, previous.y)
      context.lineTo(point.x, point.y)
      context.stroke()
    }
  }
  context.restore()
}

const OverlayApp = memo(function OverlayApp(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const storeRef = useRef<AnnotationStore | null>(null)
  const laserRef = useRef<LaserTrail | null>(null)
  const draftRef = useRef<DraftAnnotation | null>(null)
  const activePointerRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)
  const drawFrameRef = useRef<(now: number) => void>(() => undefined)

  if (storeRef.current === null) storeRef.current = new AnnotationStore()
  if (laserRef.current === null) laserRef.current = new LaserTrail()

  const [tool, setTool] = useState<ActiveTool>('pen')
  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(4)
  const [interactive, setInteractive] = useState(true)
  const [stopRequested, setStopRequested] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [history, setHistory] = useState({ undo: 0, redo: 0 })
  const [, setRevision] = useState(0)

  const scheduleDraw = useCallback((): void => {
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame((now) => drawFrameRef.current(now))
    }
  }, [])

  const markCommittedChange = useCallback((): void => {
    setHistory((current) => ({ undo: current.undo + 1, redo: 0 }))
    setRevision((current) => current + 1)
    scheduleDraw()
  }, [scheduleDraw])

  const undo = useCallback((): void => {
    if (!storeRef.current?.undo()) return
    setHistory((current) => ({ undo: Math.max(0, current.undo - 1), redo: current.redo + 1 }))
    setRevision((current) => current + 1)
    scheduleDraw()
  }, [scheduleDraw])

  const redo = useCallback((): void => {
    if (!storeRef.current?.redo()) return
    setHistory((current) => ({ undo: current.undo + 1, redo: Math.max(0, current.redo - 1) }))
    setRevision((current) => current + 1)
    scheduleDraw()
  }, [scheduleDraw])

  const cancelActiveInteraction = useCallback((): void => {
    const pointerId = activePointerRef.current
    activePointerRef.current = null
    draftRef.current = null
    const canvas = canvasRef.current
    if (pointerId !== null && canvas?.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId)
    }
    scheduleDraw()
  }, [scheduleDraw])

  const requestDesktopMode = useCallback(async (): Promise<void> => {
    cancelActiveInteraction()
    setErrorMessage('')
    setInteractive(false)
    try {
      await (window.api as OverlayApi).overlaySetInteractive({ interactive: false })
    } catch (error) {
      console.error('Failed to enable desktop pass-through mode', error)
      setErrorMessage(error instanceof Error ? error.message : 'Desktop mode is unavailable')
      setInteractive(true)
    }
  }, [cancelActiveInteraction])

  const requestStop = useCallback(async (): Promise<void> => {
    if (stopRequested) return
    setStopRequested(true)
    setErrorMessage('')
    try {
      const requested = await (window.api as OverlayApi).overlayRequestStop()
      if (!requested) {
        setStopRequested(false)
        setErrorMessage('The recording is no longer active')
      }
    } catch (error) {
      console.error('Failed to request recording stop', error)
      setErrorMessage(error instanceof Error ? error.message : 'Could not stop the recording')
      setStopRequested(false)
    }
  }, [stopRequested])

  const pointFromEvent = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }, [])

  const eraseAt = useCallback(
    (point: Point): void => {
      if (storeRef.current?.eraseAt(point, Math.max(8, width * 1.5))) markCommittedChange()
    },
    [markCommittedChange, width]
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (!interactive || activePointerRef.current !== null) return
      if (event.pointerType === 'mouse' && event.button !== 0) return

      const point = pointFromEvent(event)
      activePointerRef.current = event.pointerId
      event.currentTarget.setPointerCapture(event.pointerId)

      if (tool === 'eraser') {
        eraseAt(point)
      } else if (tool === 'laser') {
        laserRef.current = new LaserTrail()
        laserRef.current.add(point, performance.now())
        scheduleDraw()
      } else {
        draftRef.current = { tool, color, width, points: [point] }
        scheduleDraw()
      }
      event.preventDefault()
    },
    [color, eraseAt, interactive, pointFromEvent, scheduleDraw, tool, width]
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (activePointerRef.current !== event.pointerId) return
      const point = pointFromEvent(event)

      if (tool === 'eraser') {
        eraseAt(point)
      } else if (tool === 'laser') {
        laserRef.current?.add(point, performance.now())
        scheduleDraw()
      } else if (draftRef.current) {
        if (draftRef.current.tool === 'pen') {
          const previous = draftRef.current.points[draftRef.current.points.length - 1]
          if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 1) {
            draftRef.current.points.push(point)
          }
        } else {
          draftRef.current.points[1] = point
        }
        scheduleDraw()
      }
      event.preventDefault()
    },
    [eraseAt, pointFromEvent, scheduleDraw, tool]
  )

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>, commit: boolean): void => {
      if (activePointerRef.current !== event.pointerId) return

      const draft = draftRef.current
      draftRef.current = null
      activePointerRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }

      if (commit && draft) {
        const isPen = draft.tool === 'pen'
        const start = draft.points[0]
        const end = draft.points[1]
        const hasSize = isPen || (end && Math.hypot(end.x - start.x, end.y - start.y) >= 1)
        if (hasSize) {
          storeRef.current?.add(draft)
          markCommittedChange()
          return
        }
      }
      scheduleDraw()
    },
    [markCommittedChange, scheduleDraw]
  )

  const handleLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (activePointerRef.current !== event.pointerId) return
      activePointerRef.current = null
      draftRef.current = null
      scheduleDraw()
    },
    [scheduleDraw]
  )

  const clearAnnotations = useCallback((): void => {
    const store = storeRef.current
    if (!store || store.items.length === 0) return
    if (!window.confirm('Clear all annotations? You can undo this action.')) return
    store.clear()
    markCommittedChange()
  }, [markCommittedChange])

  useEffect(() => {
    const api = window.api as OverlayApi
    return api.onOverlayInteractiveChanged((nextInteractive) => {
      if (!nextInteractive) cancelActiveInteraction()
      setInteractive(nextInteractive)
    })
  }, [cancelActiveInteraction])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && interactive) {
        event.preventDefault()
        void requestDesktopMode()
        return
      }
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [interactive, redo, requestDesktopMode, undo])

  useEffect(() => {
    const drawFrame = (now: number): void => {
      frameRef.current = null
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return

      const bounds = canvas.getBoundingClientRect()
      const ratio = Math.max(1, window.devicePixelRatio || 1)
      const pixelWidth = Math.max(1, Math.round(bounds.width * ratio))
      const pixelHeight = Math.max(1, Math.round(bounds.height * ratio))
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, bounds.width, bounds.height)
      for (const annotation of storeRef.current?.items ?? []) drawAnnotation(context, annotation)
      if (draftRef.current) drawAnnotation(context, draftRef.current)

      const laserPoints = laserRef.current?.visible(now) ?? []
      drawLaser(context, laserPoints, color, width)
      if (laserPoints.length > 0) scheduleDraw()
    }

    drawFrameRef.current = drawFrame
    const handleResize = (): void => scheduleDraw()
    window.addEventListener('resize', handleResize)
    scheduleDraw()

    return () => {
      window.removeEventListener('resize', handleResize)
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      drawFrameRef.current = () => undefined
    }
  }, [color, scheduleDraw, width])

  const hasAnnotations = (storeRef.current?.items.length ?? 0) > 0

  return (
    <main className={`overlay-shell${interactive ? '' : ' overlay-shell--passthrough'}`}>
      <canvas
        ref={canvasRef}
        className="overlay-canvas"
        aria-label="Annotation canvas"
        style={{ cursor: tool === 'eraser' ? 'cell' : tool === 'laser' ? 'none' : 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishPointer(event, true)}
        onPointerCancel={(event) => finishPointer(event, false)}
        onLostPointerCapture={handleLostPointerCapture}
      />

      <div className="overlay-toolbar" role="toolbar" aria-label="Annotation controls">
        <div className="overlay-toolbar__group" role="group" aria-label="Drawing tools">
          {TOOLS.map((item) => (
            <button
              key={item.tool}
              type="button"
              className="overlay-tool-button"
              aria-label={item.label}
              aria-pressed={tool === item.tool}
              title={item.label}
              onClick={() => setTool(item.tool)}
            >
              <span aria-hidden="true">{item.glyph}</span>
            </button>
          ))}
        </div>

        <span className="overlay-toolbar__divider" aria-hidden="true" />

        <div className="overlay-toolbar__group overlay-color-group" role="group" aria-label="Stroke color">
          {COLORS.map((item) => (
            <button
              key={item}
              type="button"
              className="overlay-color-button"
              style={{ backgroundColor: item }}
              aria-label={`Use color ${item}`}
              aria-pressed={color.toLowerCase() === item.toLowerCase()}
              title={item}
              onClick={() => setColor(item)}
            />
          ))}
          <input
            className="overlay-color-input"
            type="color"
            value={color}
            aria-label="Choose custom stroke color"
            title="Custom color"
            onChange={(event) => setColor(event.target.value)}
          />
        </div>

        <label className="overlay-width-control">
          <span className="overlay-visually-hidden">Stroke width</span>
          <select
            value={width}
            aria-label="Stroke width"
            title="Stroke width"
            onChange={(event) => setWidth(Number(event.target.value))}
          >
            {WIDTHS.map((item) => (
              <option key={item} value={item}>
                {item}px
              </option>
            ))}
          </select>
        </label>

        <span className="overlay-toolbar__divider" aria-hidden="true" />

        <div className="overlay-toolbar__group" role="group" aria-label="Annotation history">
          <button
            type="button"
            className="overlay-tool-button"
            aria-label="Undo"
            title="Undo (Ctrl/Cmd+Z)"
            disabled={history.undo === 0}
            onClick={undo}
          >
            <span aria-hidden="true">↶</span>
          </button>
          <button
            type="button"
            className="overlay-tool-button"
            aria-label="Redo"
            title="Redo (Ctrl/Cmd+Shift+Z)"
            disabled={history.redo === 0}
            onClick={redo}
          >
            <span aria-hidden="true">↷</span>
          </button>
          <button
            type="button"
            className="overlay-tool-button overlay-tool-button--danger"
            aria-label="Clear all annotations"
            title="Clear all annotations"
            disabled={!hasAnnotations}
            onClick={clearAnnotations}
          >
            <span aria-hidden="true">⌧</span>
          </button>
        </div>

        <span className="overlay-toolbar__divider" aria-hidden="true" />

        <button
          type="button"
          className="overlay-desktop-button overlay-stop-button"
          aria-label="Stop recording"
          title="Stop recording (Ctrl/Cmd+Shift+S)"
          disabled={stopRequested}
          onClick={() => void requestStop()}
        >
          {stopRequested ? 'Stopping…' : 'Stop'}
        </button>

        <button
          type="button"
          className="overlay-desktop-button"
          aria-label="Switch to desktop pass-through mode"
          title="Desktop mode (Escape)"
          onClick={() => void requestDesktopMode()}
        >
          Desktop
        </button>
      </div>

      {!interactive && (
        <div className="overlay-mode-indicator" role="status">
          Desktop mode · Ctrl/Cmd+Shift+A returns to drawing
        </div>
      )}
      {errorMessage && interactive && (
        <div className="overlay-mode-indicator overlay-error-indicator" role="alert">
          {errorMessage}
        </div>
      )}
    </main>
  )
})

export default OverlayApp
