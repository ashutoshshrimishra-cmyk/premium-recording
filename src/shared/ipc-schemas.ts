import { z } from 'zod'

export const settingsSchema = z.object({
  saveDir: z.string().min(1),
  fps: z.number().int().positive(),
  resolution: z.enum(['1080p', '1440p', '4K']),
  noiseSuppression: z.boolean(),
  audioDeviceId: z.string().min(1).optional()
})

export const getSourcesInputSchema = z.void()
export const getSourcesOutputSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string(),
    displayId: z.string(),
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
export const pickFolderOutputSchema = z.string().nullable()

export const getSettingsInputSchema = z.void()
export const getSettingsOutputSchema = settingsSchema

export const setSettingsInputSchema = settingsSchema
export const setSettingsOutputSchema = settingsSchema

export const recordingSelectSourceInputSchema = z.object({
  sourceId: z.string().regex(/^screen:/)
})
export const recordingSelectSourceOutputSchema = z.boolean()

export const recordingStartInputSchema = z.object({
  sourceId: z.string().regex(/^screen:/),
  mimeType: z.string().min(1),
  fps: z.number().int().min(1).max(60),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  saveDir: z.string().min(1)
})
export const recordingStartOutputSchema = z.object({
  filePath: z.string().min(1),
  sessionId: z.string().min(16)
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
  sessionId: z.string().min(16),
  mimeType: z.string().min(1),
  discard: z.boolean().optional()
})
export const recordingStopOutputSchema = z.object({ filePath: z.string().min(1) })

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
  z.object({ type: z.literal('clear') })
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
export const overlaySaveScreenshotOutputSchema = z.object({ filePath: z.string().min(1) })

export type Settings = z.infer<typeof settingsSchema>
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
export type OverlayCommand = z.infer<typeof overlayCommandSchema>
export type OverlayHistoryState = z.infer<typeof overlayHistoryStateSchema>
export type OverlaySaveScreenshotOutput = z.infer<typeof overlaySaveScreenshotOutputSchema>
