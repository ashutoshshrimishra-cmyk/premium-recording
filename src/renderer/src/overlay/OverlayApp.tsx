import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type {
  OverlayCommand,
  OverlayShape,
  OverlayStamp,
  OverlayTool
} from '../../../shared/ipc-schemas'
import { AnnotationStore, translateAnnotation, type Point } from './annotationModel'
import { sameLayerKey, type LayerKey } from './layerCache'
import {
  drawAnnotation,
  drawSelection,
  drawSpotlight,
  measureText,
  textFont,
  type DraftAnnotation
} from './drawing'
import {
  SMOOTHING_ALPHA,
  addRipple,
  createRippleState,
  cursorEffectsActive,
  defaultCursorEffect,
  hasConverged,
  smoothPosition,
  stepRipples,
  type CursorEffectSettings,
  type Position
} from './cursorEffect'
import { drawCursorLayer } from './cursorDrawing'
import {
  DEFAULT_COLOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_SHAPE,
  DEFAULT_STAMP,
  DEFAULT_WIDTH
} from './options'

type CanvasTool = Exclude<OverlayTool, 'mouse'>

interface TextEditor {
  x: number
  y: number
}

interface DragState {
  id: string
  start: Point
  dx: number
  dy: number
}

const CURSORS: Record<CanvasTool, string> = {
  select: 'default',
  text: 'text',
  draw: 'crosshair',
  stamp: 'crosshair',
  spotlight: 'crosshair',
  eraser: 'cell'
}

/**
 * The annotation canvas. It is captured in the recording, so it contains only the drawings.
 * All controls live in the separate toolbar window and arrive here as commands.
 */
const OverlayApp = memo(function OverlayApp(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const storeRef = useRef<AnnotationStore | null>(null)
  const draftRef = useRef<DraftAnnotation | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const layerRef = useRef<{ canvas: HTMLCanvasElement; key: LayerKey | null } | null>(null)
  const hoverRef = useRef<Point | undefined>(undefined)
  const activePointerRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)
  const drawFrameRef = useRef<() => void>(() => undefined)
  const textInputRef = useRef<HTMLInputElement>(null)
  const editorClosedRef = useRef(true)
  const textEditorRef = useRef<TextEditor | null>(null)

  const cursorCanvasRef = useRef<HTMLCanvasElement>(null)
  const cursorSettingsRef = useRef<CursorEffectSettings>(defaultCursorEffect)
  const cursorTargetRef = useRef<Position | undefined>(undefined)
  const cursorShownRef = useRef<Position | undefined>(undefined)
  const cursorInsideRef = useRef(false)
  const ripplesRef = useRef(createRippleState())
  const hookSeenRef = useRef(false)
  const cursorFrameRef = useRef<number | null>(null)
  const cursorTickRef = useRef<() => void>(() => undefined)
  const cursorLayerDirtyRef = useRef(false)

  if (storeRef.current === null) storeRef.current = new AnnotationStore()

  const [tool, setTool] = useState<CanvasTool>('draw')
  const [shape, setShape] = useState<OverlayShape>(DEFAULT_SHAPE)
  const [stamp, setStamp] = useState<OverlayStamp>(DEFAULT_STAMP)
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)
  const [interactive, setInteractive] = useState(true)
  const [textEditor, setTextEditor] = useState<TextEditor | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  // Latest text settings for the commit path, which may run after a state change.
  const textSizeRef = useRef({ fontSize, color })
  useEffect(() => {
    textSizeRef.current = { fontSize, color }
  }, [fontSize, color])

  const scheduleDraw = useCallback((): void => {
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => drawFrameRef.current())
    }
  }, [])

  const scheduleCursor = useCallback((): void => {
    if (cursorFrameRef.current === null) {
      cursorFrameRef.current = requestAnimationFrame(() => cursorTickRef.current())
    }
  }, [])

  const markChanged = useCallback((): void => {
    setRevision((current) => current + 1)
    scheduleDraw()
  }, [scheduleDraw])

  const cancelActiveInteraction = useCallback((): void => {
    const pointerId = activePointerRef.current
    activePointerRef.current = null
    draftRef.current = null
    dragRef.current = null
    const canvas = canvasRef.current
    if (pointerId !== null && canvas?.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId)
    }
    scheduleDraw()
  }, [scheduleDraw])

  const closeTextEditor = useCallback(
    (commit: boolean): void => {
      if (editorClosedRef.current) return
      editorClosedRef.current = true
      const input = textInputRef.current
      const editor = textEditorRef.current
      const value = input?.value.trim() ?? ''
      textEditorRef.current = null
      setTextEditor(null)
      if (!commit || !value || !editor) return
      const context = canvasRef.current?.getContext('2d')
      const size = textSizeRef.current
      storeRef.current?.add({
        tool: 'text',
        text: value,
        fontSize: size.fontSize,
        color: size.color,
        width: 1,
        textWidth: context ? measureText(context, value, size.fontSize) : undefined,
        points: [{ x: editor.x, y: editor.y }]
      })
      markChanged()
    },
    [markChanged]
  )

  const openTextEditor = useCallback((point: Point): void => {
    editorClosedRef.current = false
    textEditorRef.current = { x: point.x, y: point.y }
    setTextEditor({ x: point.x, y: point.y })
  }, [])

  const pointFromEvent = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }, [])

  const eraseAt = useCallback(
    (point: Point): void => {
      if (storeRef.current?.eraseAt(point, Math.max(8, width * 1.5))) markChanged()
    },
    [markChanged, width]
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (
        interactive &&
        !hookSeenRef.current &&
        event.pointerType === 'mouse' &&
        cursorSettingsRef.current.ripple
      ) {
        // Fallback when the global mouse hook is not available.
        addRipple(ripplesRef.current, event.clientX, event.clientY, performance.now())
        scheduleCursor()
      }
      if (!interactive || activePointerRef.current !== null) return
      if (event.pointerType === 'mouse' && event.button !== 0) return

      const point = pointFromEvent(event)
      const store = storeRef.current
      if (!store) return

      if (tool === 'text') {
        closeTextEditor(true)
        openTextEditor(point)
        event.preventDefault()
        return
      }
      if (tool === 'spotlight') return

      if (tool === 'stamp') {
        store.add({ tool: 'stamp', stamp, color, width, points: [point] })
        markChanged()
        event.preventDefault()
        return
      }

      activePointerRef.current = event.pointerId
      event.currentTarget.setPointerCapture(event.pointerId)

      if (tool === 'select') {
        const hit = store.topmostAt(point, 6)
        setSelectedId(hit?.id ?? null)
        if (hit) dragRef.current = { id: hit.id, start: point, dx: 0, dy: 0 }
        scheduleDraw()
      } else if (tool === 'eraser') {
        eraseAt(point)
      } else {
        draftRef.current = { tool: shape, color, width, points: [point] }
        scheduleDraw()
      }
      event.preventDefault()
    },
    [
      closeTextEditor,
      color,
      eraseAt,
      interactive,
      markChanged,
      openTextEditor,
      pointFromEvent,
      scheduleCursor,
      scheduleDraw,
      shape,
      stamp,
      tool,
      width
    ]
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      const point = pointFromEvent(event)
      hoverRef.current = point
      if (tool === 'spotlight' || tool === 'stamp') scheduleDraw()
      if (activePointerRef.current !== event.pointerId) return

      if (tool === 'eraser') {
        eraseAt(point)
      } else if (tool === 'select' && dragRef.current) {
        dragRef.current.dx = point.x - dragRef.current.start.x
        dragRef.current.dy = point.y - dragRef.current.start.y
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
      const drag = dragRef.current
      draftRef.current = null
      dragRef.current = null
      activePointerRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }

      if (commit && drag && storeRef.current?.move(drag.id, drag.dx, drag.dy)) {
        markChanged()
        return
      }
      if (commit && draft) {
        const isPen = draft.tool === 'pen'
        const start = draft.points[0]
        const end = draft.points[1]
        const hasSize = isPen || (end && Math.hypot(end.x - start.x, end.y - start.y) >= 1)
        if (hasSize) {
          storeRef.current?.add(draft)
          markChanged()
          return
        }
      }
      scheduleDraw()
    },
    [markChanged, scheduleDraw]
  )

  const handleLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (activePointerRef.current !== event.pointerId) return
      activePointerRef.current = null
      draftRef.current = null
      dragRef.current = null
      scheduleDraw()
    },
    [scheduleDraw]
  )

  // Cursor layer: halo, ripples and pointer. Runs only while something moves or fades.
  useEffect(() => {
    cursorTickRef.current = (): void => {
      cursorFrameRef.current = null
      const canvas = cursorCanvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return
      if (!cursorEffectsActive(cursorSettingsRef.current)) {
        // Every effect is off: clear what was drawn once, then stop scheduling frames.
        if (cursorLayerDirtyRef.current) {
          context.setTransform(1, 0, 0, 1, 0, 0)
          context.clearRect(0, 0, canvas.width, canvas.height)
          cursorLayerDirtyRef.current = false
        }
        ripplesRef.current.ripples = []
        cursorShownRef.current = cursorTargetRef.current
        return
      }
      cursorLayerDirtyRef.current = true
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

      const target = cursorTargetRef.current
      if (target) {
        cursorShownRef.current = smoothPosition(cursorShownRef.current, target, SMOOTHING_ALPHA)
      }
      const shown = cursorShownRef.current
      const ripples = stepRipples(ripplesRef.current, performance.now())
      drawCursorLayer(context, {
        settings: cursorSettingsRef.current,
        position: cursorInsideRef.current ? shown : undefined,
        ripples
      })
      const moving = Boolean(target && shown && !hasConverged(shown, target))
      if (moving || ripples.length > 0) scheduleCursor()
    }
    scheduleCursor()
    const offCursor = window.api.onOverlayCursor((cursor) => {
      cursorTargetRef.current = { x: cursor.x, y: cursor.y }
      cursorInsideRef.current = cursor.inside
      if (cursorEffectsActive(cursorSettingsRef.current)) scheduleCursor()
    })
    const offClick = window.api.onOverlayClick((click) => {
      hookSeenRef.current = true
      if (!cursorSettingsRef.current.ripple) return
      addRipple(ripplesRef.current, click.x, click.y, performance.now())
      scheduleCursor()
    })
    const handleResize = (): void => scheduleCursor()
    window.addEventListener('resize', handleResize)
    return () => {
      offCursor()
      offClick()
      window.removeEventListener('resize', handleResize)
      if (cursorFrameRef.current !== null) cancelAnimationFrame(cursorFrameRef.current)
      cursorFrameRef.current = null
      cursorTickRef.current = () => undefined
    }
  }, [scheduleCursor])

  // Commands from the toolbar window.
  useEffect(() => {
    return window.api.onOverlayCommand((command: OverlayCommand) => {
      switch (command.type) {
        case 'tool':
          closeTextEditor(true)
          cancelActiveInteraction()
          if (command.tool !== 'mouse') setTool(command.tool)
          if (command.tool !== 'select') setSelectedId(null)
          break
        case 'shape':
          setShape(command.shape)
          break
        case 'stamp':
          setStamp(command.stamp)
          break
        case 'color':
          setColor(command.color)
          break
        case 'width':
          setWidth(command.width)
          break
        case 'fontSize':
          setFontSize(command.fontSize)
          break
        case 'undo':
          closeTextEditor(true)
          if (storeRef.current?.undo()) markChanged()
          break
        case 'redo':
          if (storeRef.current?.redo()) markChanged()
          break
        case 'cursorEffect':
          cursorSettingsRef.current = command.settings
          scheduleCursor()
          break
        case 'clear':
          closeTextEditor(false)
          storeRef.current?.clear()
          setSelectedId(null)
          markChanged()
          break
      }
    })
  }, [cancelActiveInteraction, closeTextEditor, markChanged, scheduleCursor])

  useEffect(() => {
    return window.api.onOverlayInteractiveChanged((nextInteractive) => {
      if (!nextInteractive) {
        closeTextEditor(true)
        cancelActiveInteraction()
        hoverRef.current = undefined
      }
      setInteractive(nextInteractive)
    })
  }, [cancelActiveInteraction, closeTextEditor])

  // Tell the toolbar which history buttons are usable.
  useEffect(() => {
    const store = storeRef.current
    if (!store) return
    window.api
      .overlayReportHistory({
        canUndo: store.canUndo,
        canRedo: store.canRedo,
        hasAnnotations: store.items.length > 0
      })
      .catch((error: unknown) => console.error('Could not report annotation history', error))
  }, [revision])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (editorClosedRef.current === false) return
      if (event.key === 'Escape' && interactive) {
        event.preventDefault()
        cancelActiveInteraction()
        window.api
          .overlaySetInteractive({ interactive: false })
          .catch((error: unknown) => console.error('Could not switch to mouse mode', error))
        return
      }
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selectedId &&
        storeRef.current?.remove(selectedId)
      ) {
        event.preventDefault()
        setSelectedId(null)
        markChanged()
        return
      }
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      const changed = event.shiftKey ? storeRef.current?.redo() : storeRef.current?.undo()
      if (changed) markChanged()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cancelActiveInteraction, interactive, markChanged, selectedId])

  useEffect(() => {
    const drawFrame = (): void => {
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

      const store = storeRef.current
      const items = store?.items ?? []
      const drag = dragRef.current
      const draggedId = drag && items.some((a) => a.id === drag.id) ? drag.id : null

      // Committed annotations (minus the dragged one) are cached in an
      // offscreen layer and re-rendered only when the cache key changes.
      const layer = (layerRef.current ??= {
        canvas: document.createElement('canvas'),
        key: null
      })
      const key: LayerKey = {
        version: store?.version ?? 0,
        pixelWidth,
        pixelHeight,
        ratio,
        draggedId
      }
      if (!sameLayerKey(layer.key, key)) {
        if (layer.canvas.width !== pixelWidth || layer.canvas.height !== pixelHeight) {
          layer.canvas.width = pixelWidth
          layer.canvas.height = pixelHeight
        }
        const layerContext = layer.canvas.getContext('2d')
        if (layerContext) {
          layerContext.setTransform(1, 0, 0, 1, 0, 0)
          layerContext.clearRect(0, 0, pixelWidth, pixelHeight)
          layerContext.setTransform(ratio, 0, 0, ratio, 0, 0)
          for (const annotation of items) {
            if (annotation.id !== draggedId) drawAnnotation(layerContext, annotation)
          }
          layer.key = key
        }
      }

      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, pixelWidth, pixelHeight)
      context.drawImage(layer.canvas, 0, 0)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)

      for (const annotation of items) {
        const shown =
          draggedId !== null && drag && drag.id === annotation.id
            ? translateAnnotation(annotation, drag.dx, drag.dy)
            : annotation
        if (annotation.id === draggedId) drawAnnotation(context, shown)
        if (annotation.id === selectedId && tool === 'select') drawSelection(context, shown)
      }
      if (draftRef.current) drawAnnotation(context, draftRef.current)

      if (interactive && tool === 'spotlight') {
        drawSpotlight(context, bounds.width, bounds.height, hoverRef.current)
      }
      if (interactive && tool === 'stamp' && hoverRef.current) {
        context.save()
        context.globalAlpha = 0.5
        drawAnnotation(context, { tool: 'stamp', stamp, color, width, points: [hoverRef.current] })
        context.restore()
      }
    }

    drawFrameRef.current = drawFrame
    const handleResize = (): void => {
      scheduleDraw()
      scheduleCursor()
    }
    window.addEventListener('resize', handleResize)
    // A display scale change does not always resize the window, so watch the pixel ratio too.
    let ratioQuery: MediaQueryList | undefined
    const watchRatio = (): void => {
      ratioQuery?.removeEventListener('change', handleRatio)
      ratioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      ratioQuery.addEventListener('change', handleRatio)
    }
    function handleRatio(): void {
      handleResize()
      watchRatio()
    }
    watchRatio()
    scheduleDraw()

    return () => {
      window.removeEventListener('resize', handleResize)
      ratioQuery?.removeEventListener('change', handleRatio)
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      drawFrameRef.current = () => undefined
    }
  }, [color, interactive, revision, scheduleCursor, scheduleDraw, selectedId, stamp, tool, width])

  useEffect(() => {
    if (textEditor) textInputRef.current?.focus()
  }, [textEditor])

  const handleTextKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      closeTextEditor(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeTextEditor(false)
    }
  }

  return (
    <main className="overlay-shell">
      <canvas ref={cursorCanvasRef} className="overlay-cursor-layer" aria-hidden="true" />
      <canvas
        ref={canvasRef}
        className="overlay-canvas"
        aria-label="Annotation canvas"
        style={{ cursor: CURSORS[tool] }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishPointer(event, true)}
        onPointerCancel={(event) => finishPointer(event, false)}
        onPointerLeave={() => {
          hoverRef.current = undefined
          if (tool === 'stamp') scheduleDraw()
        }}
        onLostPointerCapture={handleLostPointerCapture}
      />
      {textEditor && (
        <input
          ref={textInputRef}
          className="overlay-text-input"
          type="text"
          aria-label="Annotation text"
          placeholder="Type, then press Enter"
          style={{
            left: textEditor.x,
            top: textEditor.y,
            color,
            font: textFont(fontSize),
            lineHeight: 1.25
          }}
          onKeyDown={handleTextKeyDown}
          onBlur={() => closeTextEditor(true)}
        />
      )}
    </main>
  )
})

export default OverlayApp
