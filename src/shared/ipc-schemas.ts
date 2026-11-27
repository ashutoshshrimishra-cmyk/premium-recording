import { z } from 'zod'
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS } from './shortcuts'
import { MAX_PATH_LENGTH, looksAbsolutePath } from './pathRules'

const pathString = z.string().min(1).max(MAX_PATH_LENGTH)
/** A bounded absolute file path (POSIX, Windows drive or UNC). */
export const absolutePathSchema = pathString.refine(looksAbsolutePath, {
  message: 'Expected an absolute path'
})
const sourceIdSchema = z
  .string()
  .max(200)
  .regex(/^(screen|window):/)
const mimeTypeSchema = z.string().min(1).max(200)

const shortcutString = (fallback: string): z.ZodDefault<z.ZodString> =>
  z.string().min(1).max(60).default(fallback)

export const shortcutsSchema = z.object({
  startStop: shortcutString(DEFAULT_SHORTCUTS.startStop),
  pauseResume: shortcutString(DEFAULT_SHORTCUTS.pauseResume),
  toggleAnnotation: shortcutString(DEFAULT_SHORTCUTS.toggleAnnotation),
  screenshot: shortcutString(DEFAULT_SHORTCUTS.screenshot)
})

/** Fields added after 1.2 have defaults, so settings saved by older versions still load. */
export const settingsSchema = z.object({
  saveDir: pathString,
  fps: z.number().int().positive(),
  resolution: z.enum(['1080p', '1440p', '4K']),
  noiseSuppression: z.boolean(),
  audioDeviceId: z.string().min(1).optional(),
  countdownSeconds: z.union([z.literal(0), z.literal(3), z.literal(5)]).default(3),
  openFolderAfterSave: z.boolean().default(false),
  cursorEffect: z.boolean().default(true),
  annotationStartsActive: z.boolean().default(true),
  shortcuts: shortcutsSchema.prefault({})
})

export const shortcutActionSchema = z.enum(SHORTCUT_ACTIONS)
export const shortcutFailureSchema = z.object({
  action: shortcutActionSchema,
  accelerator: z.string(),
  reason: z.string()
})
export const shortcutsResultSchema = z.object({
  ok: z.boolean(),
  failed: z.array(shortcutFailureSchema),
  shortcuts: shortcutsSchema
})
export const shortcutsGetInputSchema = z.void()
export const shortcutsSetInputSchema = shortcutsSchema
export const shortcutsSuspendInputSchema = z.object({ suspended: z.boolean() })
export const shortcutsSuspendOutputSchema = z.boolean()
export const shortcutActionEventSchema = z.enum(['startStop', 'pauseResume'])

export const recentRecordingSchema = z.object({
  filePath: absolutePathSchema,
  sizeBytes: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  savedAt: z.string()
})
export const recentListInputSchema = z.void()
export const recentListOutputSchema = z.array(recentRecordingSchema)
export const recentAddInputSchema = z.object({
  filePath: absolutePathSchema,
  durationMs: z
    .number()
    .nonnegative()
    .max(1000 * 60 * 60 * 72)
})
export const recentPathInputSchema = z.object({ filePath: absolutePathSchema })
export const recentActionOutputSchema = z.boolean()

export const abandonedPartSchema = z.object({
  partPath: z.string().min(1),
  sizeBytes: z.number().nonnegative(),
  modifiedAt: z.string(),
  suggestedFinalPath: z.string().min(1)
})
export const recoveryListInputSchema = z.void()
export const recoveryListOutputSchema = z.array(abandonedPartSchema)
export const recoveryPathInputSchema = z.object({ partPath: absolutePathSchema })
export const recoveryRecoverOutputSchema = z.object({ filePath: pathString })
export const recoveryDiscardOutputSchema = z.boolean()

export const getSourcesInputSchema = z.object({ kind: z.enum(['screen', 'window']) })
export const getSourcesOutputSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string(),
    displayId: z.string(),
    kind: z.enum(['screen', 'window']),
    label: z.string(),
    bounds: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number().nonnegative(),
        height: z.number().nonnegative()
      })
      .optional(),
    thumbnail: z.string().startsWith('data:')
  })
)

export const getDisplaysInputSchema = z.void()
export const getDisplaysOutputSchema = z.array(
  z.object({
    id: z.string(),
    bounds: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number().nonnegative(),
      height: z.number().nonnegative()
    }),
    scaleFactor: z.number().positive()
  })
)

export const pickFolderInputSchema = z.void()
export const pickFolderOutputSchema = pathString.nullable()

export const getSettingsInputSchema = z.void()
export const getSettingsOutputSchema = settingsSchema

/** The save folder is not accepted here, it only changes through the main-process folder picker. */
export const setSettingsInputSchema = settingsSchema.omit({ saveDir: true })
export const setSettingsOutputSchema = settingsSchema

export const recordingSelectSourceInputSchema = z.object({ sourceId: sourceIdSchema })
export const recordingSelectSourceOutputSchema = z.boolean()

/** No save folder: the main process records into its stored settings folder. */
export const recordingStartInputSchema = z.object({
  sourceId: sourceIdSchema,
  mimeType: mimeTypeSchema,
  fps: z.number().int().min(1).max(60),
  width: z.number().int().positive().max(16384),
  height: z.number().int().positive().max(16384)
})
export const recordingStartOutputSchema = z.object({
  filePath: pathString,
  sessionId: z.string().min(16),
  overlay: z.object({
    canvas: z.boolean(),
    toolbar: z.boolean(),
    error: z.string().max(500).optional()
  })
})

const binaryChunkSchema = z.custom<ArrayBuffer | ArrayBufferView>(
  (value) =>
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    Object.prototype.toString.call(value) === '[object ArrayBuffer]',
  'Expected binary chunk data'
)
export const recordingChunkInputSchema = z.object({
  sessionId: z.string().min(16),
  data: binaryChunkSchema.refine((value) => value.byteLength <= 16 * 1024 * 1024, {
    message: 'Recording chunk exceeds 16 MB'
  })
})
export const recordingChunkOutputSchema = z.boolean()

export const recordingStopInputSchema = z.object({
  sessionId: z.string().min(16).max(100),
  mimeType: mimeTypeSchema,
  discard: z.boolean().optional()
})
/**
 * Stop never throws for file problems. A failure carries a code and, when the partial data was
 * kept, the .part path so the UI can point to recovery.
 */
export const recordingStopOutputSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), filePath: pathString }),
  z.object({
    ok: z.literal(false),
    code: z.enum(['cancelled', 'empty', 'save-failed', 'error']),
    message: z.string().max(2000),
    preservedPath: pathString.optional()
  })
])

/** Free space warning pushed to the recording window during a recording. */
export const recordingDiskSpaceSchema = z.object({
  level: z.enum(['low', 'critical']),
  availableBytes: z.number().nonnegative()
})
export type RecordingDiskSpace = z.infer<typeof recordingDiskSpaceSchema>

export const overlaySetInteractiveInputSchema = z.object({ interactive: z.boolean() })
export const overlaySetInteractiveOutputSchema = z.boolean()
export const overlayRequestStopInputSchema = z.void()
export const overlayRequestStopOutputSchema = z.boolean()

export const overlayToolSchema = z.enum([
  'mouse',
  'select',
  'text',
  'draw',
  'stamp',
  'spotlight',
  'eraser'
])
export const overlayShapeSchema = z.enum([
  'pen',
  'line',
  'arrow',
  'doubleArrow',
  'rect',
  'roundRect',
  'ellipse'
])
export const overlayStampSchema = z.enum(['check', 'cross', 'star', 'heart', 'question', 'arrow'])

export const cursorEffectSettingsSchema = z.object({
  highlight: z.boolean(),
  ripple: z.boolean(),
  drawPointer: z.boolean(),
  highlightColor: z.string().max(40),
  radius: z.number().min(8).max(120)
})

/** Cursor position relative to the captured display, pushed from the main process. */
export const overlayCursorSchema = z.object({
  x: z.number(),
  y: z.number(),
  inside: z.boolean()
})

/** A global mouse click relative to the captured display. */
export const overlayClickSchema = z.object({
  x: z.number(),
  y: z.number(),
  button: z.enum(['left', 'right'])
})

/** Commands sent from the toolbar window to the annotation canvas window (through the main process). */
export const overlayCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tool'), tool: overlayToolSchema }),
  z.object({ type: z.literal('shape'), shape: overlayShapeSchema }),
  z.object({ type: z.literal('stamp'), stamp: overlayStampSchema }),
  z.object({ type: z.literal('color'), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ type: z.literal('width'), width: z.number().int().min(1).max(40) }),
  z.object({ type: z.literal('fontSize'), fontSize: z.number().int().min(8).max(200) }),
  z.object({ type: z.literal('undo') }),
  z.object({ type: z.literal('redo') }),
  z.object({ type: z.literal('clear') }),
  z.object({ type: z.literal('cursorEffect'), settings: cursorEffectSettingsSchema })
])
export const overlayCommandOutputSchema = z.boolean()

/** History state sent from the canvas window to the toolbar window. */
export const overlayHistoryStateSchema = z.object({
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  hasAnnotations: z.boolean()
})
export const overlayReportHistoryOutputSchema = z.boolean()

export const overlaySaveScreenshotInputSchema = z.void()
export const overlaySaveScreenshotOutputSchema = z.object({ filePath: pathString })

/** Microphone commands sent from the annotation panel to the recording window (through the main process). */
export const micCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mute'), muted: z.boolean() }),
  z.object({ type: z.literal('denoise'), active: z.boolean() })
])
export const micCommandOutputSchema = z.boolean()

/** Microphone state sent from the recording window to the panel (about 10 times per second). */
export const micStateSchema = z.object({
  muted: z.boolean(),
  level: z.number().min(0).max(1),
  denoised: z.boolean(),
  bypassed: z.boolean(),
  /** True when AI noise removal could be started for this recording. */
  available: z.boolean()
})
export const micStateOutputSchema = z.boolean()

export const panelDockSchema = z.enum(['right', 'left', 'top', 'bottom'])
export const panelLayoutSchema = z.object({ dock: panelDockSchema, expanded: z.boolean() })
export const panelGetLayoutInputSchema = z.void()
export const panelSetLayoutInputSchema = z.object({
  dock: panelDockSchema.optional(),
  expanded: z.boolean().optional()
})

export const diagnosticsLogInputSchema = z.object({ line: z.string().max(2000) })
export const diagnosticsLogOutputSchema = z.boolean()
export const diagnosticsGetInfoInputSchema = z.void()
export const diagnosticsGetInfoOutputSchema = z.object({
  logPath: z.string(),
  version: z.string(),
  commit: z.string(),
  platform: z.string(),
  osRelease: z.string(),
  windowsBuild: z.number().int().nullable(),
  captureMode: z.enum(['exclude', 'include-unprotected'])
})
export const diagnosticsShowLogInputSchema = z.void()
export const diagnosticsShowLogOutputSchema = z.boolean()
export const diagnosticsProbeFileInputSchema = z.object({ filePath: absolutePathSchema })
export const diagnosticsProbeFileOutputSchema = z.enum(['present', 'absent', 'unknown'])

export type Settings = z.infer<typeof settingsSchema>
export type ShortcutsConfig = z.infer<typeof shortcutsSchema>
export type ShortcutFailure = z.infer<typeof shortcutFailureSchema>
export type ShortcutsResult = z.infer<typeof shortcutsResultSchema>
export type ShortcutActionEvent = z.infer<typeof shortcutActionEventSchema>
export type AbandonedPart = z.infer<typeof abandonedPartSchema>
export type RecentRecording = z.infer<typeof recentRecordingSchema>
export type GetSourcesInput = z.infer<typeof getSourcesInputSchema>
export type GetSourcesOutput = z.infer<typeof getSourcesOutputSchema>
export type GetDisplaysInput = z.infer<typeof getDisplaysInputSchema>
export type GetDisplaysOutput = z.infer<typeof getDisplaysOutputSchema>
export type PickFolderInput = z.infer<typeof pickFolderInputSchema>
export type PickFolderOutput = z.infer<typeof pickFolderOutputSchema>
export type GetSettingsInput = z.infer<typeof getSettingsInputSchema>
export type GetSettingsOutput = z.infer<typeof getSettingsOutputSchema>
export type SetSettingsInput = z.infer<typeof setSettingsInputSchema>
export type SetSettingsOutput = z.infer<typeof setSettingsOutputSchema>
export type RecordingSelectSourceInput = z.infer<typeof recordingSelectSourceInputSchema>
export type RecordingStartInput = z.infer<typeof recordingStartInputSchema>
export type RecordingStartOutput = z.infer<typeof recordingStartOutputSchema>
export type RecordingChunkInput = z.infer<typeof recordingChunkInputSchema>
export type RecordingChunkOutput = z.infer<typeof recordingChunkOutputSchema>
export type RecordingStopInput = z.infer<typeof recordingStopInputSchema>
export type RecordingStopOutput = z.infer<typeof recordingStopOutputSchema>
export type OverlaySetInteractiveInput = z.infer<typeof overlaySetInteractiveInputSchema>
export type OverlaySetInteractiveOutput = z.infer<typeof overlaySetInteractiveOutputSchema>
export type OverlayRequestStopInput = z.infer<typeof overlayRequestStopInputSchema>
export type OverlayRequestStopOutput = z.infer<typeof overlayRequestStopOutputSchema>
export type OverlayTool = z.infer<typeof overlayToolSchema>
export type OverlayShape = z.infer<typeof overlayShapeSchema>
export type OverlayStamp = z.infer<typeof overlayStampSchema>
export type OverlayCursor = z.infer<typeof overlayCursorSchema>
export type OverlayClick = z.infer<typeof overlayClickSchema>
export type OverlayCommand = z.infer<typeof overlayCommandSchema>
export type OverlayHistoryState = z.infer<typeof overlayHistoryStateSchema>
export type MicCommand = z.infer<typeof micCommandSchema>
export type MicState = z.infer<typeof micStateSchema>
export type PanelDock = z.infer<typeof panelDockSchema>
export type PanelLayout = z.infer<typeof panelLayoutSchema>
export type PanelSetLayoutInput = z.infer<typeof panelSetLayoutInputSchema>
export type DiagnosticsInfo = z.infer<typeof diagnosticsGetInfoOutputSchema>
export type DiagnosticsProbeFileOutput = z.infer<typeof diagnosticsProbeFileOutputSchema>
export type OverlaySaveScreenshotOutput = z.infer<typeof overlaySaveScreenshotOutputSchema>
