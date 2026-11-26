import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  Check,
  Circle,
  CircleQuestionMark,
  Eraser,
  Flashlight,
  GripVertical,
  Heart,
  MousePointer2,
  MoveDiagonal,
  MoveUpRight,
  Pencil,
  Redo2,
  RectangleHorizontal,
  Save,
  Slash,
  Square,
  SquareDashedMousePointer,
  Stamp,
  Star,
  Trash2,
  Type,
  Undo2,
  X,
  type LucideIcon
} from 'lucide-react'
import type {
  OverlayCommand,
  OverlayHistoryState,
  OverlayShape,
  OverlayStamp,
  OverlayTool
} from '../../../shared/ipc-schemas'
import {
  COLORS,
  DEFAULT_COLOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_SHAPE,
  DEFAULT_STAMP,
  DEFAULT_WIDTH,
  FONT_SIZES,
  WIDTHS
} from '../overlay/options'

type Panel = 'tool' | 'format'
type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

const TOOLS: ReadonlyArray<{ tool: OverlayTool; label: string; Icon: LucideIcon }> = [
  { tool: 'mouse', label: 'Mouse', Icon: MousePointer2 },
  { tool: 'select', label: 'Select', Icon: SquareDashedMousePointer },
  { tool: 'text', label: 'Text', Icon: Type },
  { tool: 'draw', label: 'Draw', Icon: Pencil },
  { tool: 'stamp', label: 'Stamp', Icon: Stamp },
  { tool: 'spotlight', label: 'Spotlight', Icon: Flashlight },
  { tool: 'eraser', label: 'Eraser', Icon: Eraser }
]

const SHAPES: ReadonlyArray<{ shape: OverlayShape; label: string; Icon: LucideIcon }> = [
  { shape: 'pen', label: 'Pen', Icon: Pencil },
  { shape: 'line', label: 'Line', Icon: Slash },
  { shape: 'arrow', label: 'Arrow', Icon: MoveUpRight },
  { shape: 'doubleArrow', label: 'Double arrow', Icon: MoveDiagonal },
  { shape: 'rect', label: 'Rectangle', Icon: Square },
  { shape: 'roundRect', label: 'Rounded', Icon: RectangleHorizontal },
  { shape: 'ellipse', label: 'Ellipse', Icon: Circle }
]

const STAMPS: ReadonlyArray<{ stamp: OverlayStamp; label: string; Icon: LucideIcon }> = [
  { stamp: 'check', label: 'Check', Icon: Check },
  { stamp: 'cross', label: 'Cross', Icon: X },
  { stamp: 'star', label: 'Star', Icon: Star },
  { stamp: 'heart', label: 'Heart', Icon: Heart },
  { stamp: 'question', label: 'Question', Icon: CircleQuestionMark },
  { stamp: 'arrow', label: 'Arrow', Icon: ArrowRight }
]

function ToolButton(props: {
  label: string
  icon: ReactNode
  pressed?: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="tb-button"
      aria-pressed={props.pressed}
      disabled={props.disabled}
      title={props.title ?? props.label}
      onClick={props.onClick}
    >
      <span className="tb-button__icon" aria-hidden="true">
        {props.icon}
      </span>
      <span className="tb-button__label">{props.label}</span>
    </button>
  )
}

function ChipButton(props: {
  label: string
  icon?: ReactNode
  pressed: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="tb-chip"
      aria-pressed={props.pressed}
      title={props.label}
      onClick={props.onClick}
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  )
}

const ToolbarApp = memo(function ToolbarApp(): React.JSX.Element {
  const [tool, setTool] = useState<OverlayTool>('draw')
  const lastDrawingTool = useRef<OverlayTool>('draw')
  const [panel, setPanel] = useState<Panel>('tool')
  const [shape, setShape] = useState<OverlayShape>(DEFAULT_SHAPE)
  const [stamp, setStamp] = useState<OverlayStamp>(DEFAULT_STAMP)
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)
  const [history, setHistory] = useState<OverlayHistoryState>({
    canUndo: false,
    canRedo: false,
    hasAnnotations: false
  })
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [stopping, setStopping] = useState(false)
  const [message, setMessage] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const send = useCallback((command: OverlayCommand): void => {
    window.api.overlaySendCommand(command).catch((error: unknown) => {
      console.error('Annotation command failed', error)
      setMessage(error instanceof Error ? error.message : 'The annotation command failed')
    })
  }, [])

  useEffect(() => {
    const offHistory = window.api.onOverlayHistoryChanged(setHistory)
    // Ctrl/Cmd+Shift+A or Escape on the canvas can switch modes without the toolbar.
    const offMode = window.api.onOverlayInteractiveChanged((interactive) => {
      if (!interactive) {
        setTool('mouse')
      } else {
        setTool((current) => (current === 'mouse' ? lastDrawingTool.current : current))
      }
    })
    return () => {
      offHistory()
      offMode()
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  const chooseTool = (next: OverlayTool): void => {
    setMessage('')
    setPanel('tool')
    setTool(next)
    if (next !== 'mouse') lastDrawingTool.current = next
    send({ type: 'tool', tool: next })
  }

  const chooseShape = (next: OverlayShape): void => {
    setShape(next)
    send({ type: 'shape', shape: next })
  }

  const chooseStamp = (next: OverlayStamp): void => {
    setStamp(next)
    send({ type: 'stamp', stamp: next })
  }

  const chooseColor = (next: string): void => {
    setColor(next)
    send({ type: 'color', color: next })
  }

  const chooseWidth = (next: number): void => {
    setWidth(next)
    send({ type: 'width', width: next })
  }

  const chooseFontSize = (next: number): void => {
    setFontSize(next)
    send({ type: 'fontSize', fontSize: next })
  }

  const requestStop = (): void => {
    if (stopping) return
    setStopping(true)
    setMessage('')
    window.api
      .overlayRequestStop()
      .then((requested) => {
        if (!requested) {
          setStopping(false)
          setMessage('The recording is no longer active')
        }
      })
      .catch((error: unknown) => {
        setStopping(false)
        setMessage(error instanceof Error ? error.message : 'Could not stop the recording')
      })
  }

  const saveScreenshot = (): void => {
    if (saveState === 'saving') return
    setSaveState('saving')
    setMessage('')
    window.api
      .overlaySaveScreenshot()
      .then((result) => {
        setSaveState('saved')
        setMessage(`Saved ${result.filePath}`)
      })
      .catch((error: unknown) => {
        setSaveState('failed')
        setMessage(error instanceof Error ? error.message : 'The screenshot could not be saved')
      })
      .finally(() => {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
          setSaveState('idle')
          setMessage('')
        }, 3000)
      })
  }

  const saveLabel =
    saveState === 'saving'
      ? 'Saving'
      : saveState === 'saved'
        ? 'Saved'
        : saveState === 'failed'
          ? 'Failed'
          : 'Save'

  const formatOptions = (
    <>
      <div className="tb-group" role="group" aria-label="Color">
        {COLORS.map((item) => (
          <button
            key={item}
            type="button"
            className="tb-swatch"
            style={{ backgroundColor: item }}
            aria-label={`Color ${item}`}
            aria-pressed={color.toLowerCase() === item.toLowerCase()}
            onClick={() => chooseColor(item)}
          />
        ))}
        <input
          className="tb-color-input"
          type="color"
          value={color}
          aria-label="Custom color"
          title="Custom color"
          onChange={(event) => chooseColor(event.target.value)}
        />
      </div>
      <div className="tb-group" role="group" aria-label="Stroke width">
        {WIDTHS.map((item) => (
          <button
            key={item}
            type="button"
            className="tb-width"
            aria-pressed={width === item}
            aria-label={`Stroke width ${item}`}
            title={`${item}px`}
            onClick={() => chooseWidth(item)}
          >
            <span style={{ height: item, background: width === item ? '#fff' : '#9b9da6' }} />
          </button>
        ))}
      </div>
      <div className="tb-group" role="group" aria-label="Text size">
        {FONT_SIZES.map((item) => (
          <button
            key={item.size}
            type="button"
            className="tb-chip tb-chip--compact"
            aria-pressed={fontSize === item.size}
            title={`Text size ${item.size}px`}
            onClick={() => chooseFontSize(item.size)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  )

  let options: ReactNode
  if (message) {
    options = (
      <p className="tb-hint tb-hint--status" role="status" title={message}>
        {message}
      </p>
    )
  } else if (panel === 'format') {
    options = formatOptions
  } else if (tool === 'draw') {
    options = (
      <div className="tb-group" role="group" aria-label="Drawing shape">
        {SHAPES.map(({ shape: item, label, Icon }) => (
          <ChipButton
            key={item}
            label={label}
            icon={<Icon size={15} />}
            pressed={shape === item}
            onClick={() => chooseShape(item)}
          />
        ))}
      </div>
    )
  } else if (tool === 'stamp') {
    options = (
      <div className="tb-group" role="group" aria-label="Stamp">
        {STAMPS.map(({ stamp: item, label, Icon }) => (
          <ChipButton
            key={item}
            label={label}
            icon={<Icon size={15} />}
            pressed={stamp === item}
            onClick={() => chooseStamp(item)}
          />
        ))}
      </div>
    )
  } else {
    const hints: Record<OverlayTool, string> = {
      mouse: 'Mouse mode: use your desktop. Press Ctrl+Shift+A or pick a tool to draw again.',
      select: 'Click an annotation and drag to move it. Press Delete to remove it.',
      text: 'Click on the screen, type, then press Enter to place the text. Esc cancels.',
      draw: '',
      stamp: '',
      spotlight: 'The screen is dimmed except around your cursor.',
      eraser: 'Click or drag over an annotation to erase it.'
    }
    options = <p className="tb-hint">{hints[tool]}</p>
  }

  return (
    <div className="tb-root">
      <div className="tb-row tb-row--main" role="toolbar" aria-label="Annotation tools">
        <div className="tb-drag" title="Drag to move the toolbar" aria-hidden="true">
          <GripVertical size={18} />
        </div>
        {TOOLS.map(({ tool: item, label, Icon }) => (
          <ToolButton
            key={item}
            label={label}
            icon={<Icon size={22} />}
            pressed={tool === item && panel === 'tool'}
            onClick={() => chooseTool(item)}
          />
        ))}
        <ToolButton
          label="Format"
          title="Color, stroke width and text size"
          icon={<span className="tb-format-swatch" style={{ backgroundColor: color }} />}
          pressed={panel === 'format'}
          onClick={() => setPanel((current) => (current === 'format' ? 'tool' : 'format'))}
        />
        <span className="tb-divider" aria-hidden="true" />
        <ToolButton
          label="Undo"
          title="Undo (Ctrl+Z)"
          icon={<Undo2 size={22} />}
          disabled={!history.canUndo}
          onClick={() => send({ type: 'undo' })}
        />
        <ToolButton
          label="Redo"
          title="Redo (Ctrl+Shift+Z)"
          icon={<Redo2 size={22} />}
          disabled={!history.canRedo}
          onClick={() => send({ type: 'redo' })}
        />
        <ToolButton
          label="Clear"
          title="Clear all annotations (can be undone)"
          icon={<Trash2 size={22} />}
          disabled={!history.hasAnnotations}
          onClick={() => send({ type: 'clear' })}
        />
        <ToolButton
          label={saveLabel}
          title="Save a screenshot of the screen with your annotations"
          icon={saveState === 'saved' ? <Check size={22} /> : <Save size={22} />}
          disabled={saveState === 'saving'}
          pressed={saveState === 'saved'}
          onClick={saveScreenshot}
        />
        <button
          type="button"
          className="tb-close"
          aria-label="Stop recording and close annotation tools"
          title="Stop recording"
          disabled={stopping}
          onClick={requestStop}
        >
          <X size={20} strokeWidth={3} />
        </button>
      </div>

      <div className="tb-row tb-row--options">
        <div className="tb-options">{options}</div>
        <button
          type="button"
          className="tb-stop"
          title="Stop recording (Ctrl+Shift+S)"
          disabled={stopping}
          onClick={requestStop}
        >
          <Square size={14} fill="currentColor" aria-hidden="true" />
          {stopping ? 'Stopping…' : 'Stop recording'}
        </button>
      </div>
    </div>
  )
})

export default ToolbarApp
