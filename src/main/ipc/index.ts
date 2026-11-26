import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  screen,
  type IpcMainInvokeEvent
} from 'electron'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import Store from 'electron-store'
import {
  getSourcesInputSchema,
  getSourcesOutputSchema,
  getDisplaysInputSchema,
  getDisplaysOutputSchema,
  pickFolderInputSchema,
  pickFolderOutputSchema,
  getSettingsInputSchema,
  getSettingsOutputSchema,
  setSettingsInputSchema,
  setSettingsOutputSchema,
  recordingSelectSourceInputSchema,
  recordingSelectSourceOutputSchema,
  recordingStartInputSchema,
  recordingStartOutputSchema,
  recordingChunkInputSchema,
  recordingChunkOutputSchema,
  recordingStopInputSchema,
  recordingStopOutputSchema,
  overlaySetInteractiveInputSchema,
  overlaySetInteractiveOutputSchema,
  overlayRequestStopInputSchema,
  overlayRequestStopOutputSchema,
  overlayCommandSchema,
  overlayCommandOutputSchema,
  overlayHistoryStateSchema,
  overlayReportHistoryOutputSchema,
  overlaySaveScreenshotInputSchema,
  overlaySaveScreenshotOutputSchema,
  type Settings
} from '../../shared/ipc-schemas'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import {
  appendRecordingChunk,
  discardActiveRecording,
  setSelectedSourceId,
  startRecordingFile,
  stopRecordingFile
} from '../recording'
import {
  closeAnnotationOverlay,
  forwardOverlayCommand,
  forwardOverlayHistory,
  isAnnotationCanvasSender,
  isAnnotationOverlaySender,
  isAnnotationToolbarSender,
  openAnnotationOverlay,
  requestRecordingStop,
  saveAnnotationScreenshot,
  setAnnotationInteractive
} from '../windows/overlay'

interface ActiveRecordingSession {
  id: string
  ownerId: number
  detachLifecycle: () => void
  discardPromise?: Promise<void>
}

function getSettingsDefaults(): Settings {
  return {
    saveDir: join(app.getPath('videos'), 'MyRecorder'),
    fps: 30,
    resolution: '1080p',
    noiseSuppression: true,
    audioDeviceId: 'default'
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function isFromOwnApp(event: IpcMainInvokeEvent): boolean {
  const frameUrl = event.senderFrame?.url
  if (!frameUrl || !BrowserWindow.fromWebContents(event.sender)) return false
  if (frameUrl.startsWith('file://')) return true

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (!rendererUrl) return false

  try {
    return new URL(frameUrl).origin === new URL(rendererUrl).origin
  } catch {
    return false
  }
}

function validateSender(event: IpcMainInvokeEvent): void {
  if (!isFromOwnApp(event)) throw new Error('IPC request blocked: untrusted sender')
}

export function registerIpc(): void {
  const settingsDefaults = getSettingsDefaults()
  const store = new Store<Settings>({ name: 'settings', defaults: settingsDefaults })
  let activeSession: ActiveRecordingSession | undefined

  ipcMain.handle(IPC_CHANNELS.getSources, async (event, input: unknown) => {
    validateSender(event)
    getSourcesInputSchema.parse(input)
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false
    })
    return getSourcesOutputSchema.parse(
      sources.map((source) => ({
        id: source.id,
        name: source.name,
        displayId: source.display_id,
        thumbnail: source.thumbnail.toDataURL()
      }))
    )
  })

  ipcMain.handle(IPC_CHANNELS.getDisplays, (event, input: unknown) => {
    validateSender(event)
    getDisplaysInputSchema.parse(input)
    return getDisplaysOutputSchema.parse(
      screen.getAllDisplays().map((display) => ({
        id: String(display.id),
        bounds: { ...display.bounds },
        scaleFactor: display.scaleFactor
      }))
    )
  })

  ipcMain.handle(IPC_CHANNELS.pickFolder, async (event, input: unknown) => {
    validateSender(event)
    pickFolderInputSchema.parse(input)
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory']
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    return pickFolderOutputSchema.parse(result.canceled ? null : (result.filePaths[0] ?? null))
  })

  ipcMain.handle(IPC_CHANNELS.getSettings, (event, input: unknown) => {
    validateSender(event)
    getSettingsInputSchema.parse(input)
    const result: Settings = {
      saveDir: ((saved: string): string => (isAbsolute(saved) ? saved : settingsDefaults.saveDir))(
        store.get('saveDir', settingsDefaults.saveDir)
      ),
      fps: store.get('fps', settingsDefaults.fps),
      resolution: store.get('resolution', settingsDefaults.resolution),
      noiseSuppression: store.get('noiseSuppression', settingsDefaults.noiseSuppression),
      audioDeviceId: store.get('audioDeviceId', 'default') || 'default'
    }
    return getSettingsOutputSchema.parse(result)
  })

  ipcMain.handle(IPC_CHANNELS.setSettings, (event, input: unknown) => {
    validateSender(event)
    const settings = setSettingsInputSchema.parse(input)
    store.set({ ...settings, audioDeviceId: settings.audioDeviceId ?? 'default' })
    return setSettingsOutputSchema.parse(settings)
  })

  ipcMain.handle(IPC_CHANNELS.recordingSelectSource, (event, input: unknown) => {
    validateSender(event)
    if (activeSession) throw new Error('A recording is already in progress')
    const { sourceId } = recordingSelectSourceInputSchema.parse(input)
    setSelectedSourceId(sourceId)
    return recordingSelectSourceOutputSchema.parse(true)
  })

  ipcMain.handle(IPC_CHANNELS.recordingStart, async (event, input: unknown) => {
    validateSender(event)
    if (activeSession) throw new Error('A recording is already in progress')
    const recording = recordingStartInputSchema.parse(input)
    const sessionId = randomUUID()
    const owner = event.sender
    const win = BrowserWindow.fromWebContents(owner)
    const cleanupOnOwnerLoss = (): void => {
      if (activeSession?.id !== sessionId) return
      closeAnnotationOverlay()
      activeSession.discardPromise ??= discardActiveRecording()
      void activeSession.discardPromise.finally(() => {
        if (activeSession?.id === sessionId) {
          activeSession.detachLifecycle()
          activeSession = undefined
        }
      })
    }
    const detachLifecycle = (): void => {
      owner.removeListener('destroyed', cleanupOnOwnerLoss)
      owner.removeListener('render-process-gone', cleanupOnOwnerLoss)
    }
    const sessionRecord: ActiveRecordingSession = {
      id: sessionId,
      ownerId: owner.id,
      detachLifecycle
    }
    activeSession = sessionRecord
    owner.once('destroyed', cleanupOnOwnerLoss)
    owner.once('render-process-gone', cleanupOnOwnerLoss)

    let fileStarted = false
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 },
        fetchWindowIcons: false
      })
      if (activeSession?.id !== sessionId) throw new Error('Recording startup was cancelled')
      const source = sources.find((candidate) => candidate.id === recording.sourceId)
      if (!source) throw new Error('The selected screen is no longer available')

      const filePath = await startRecordingFile(recording.saveDir, new Date(), recording.mimeType)
      fileStarted = true
      if (activeSession?.id !== sessionId) throw new Error('Recording startup was cancelled')

      if (win && !win.isDestroyed() && !win.isMinimized()) {
        win.minimize()
        await sleep(300)
      }
      if (activeSession?.id !== sessionId) throw new Error('Recording startup was cancelled')
      const overlay = await openAnnotationOverlay(source.display_id, owner, recording.saveDir)
      // Without a toolbar the user could not stop from the screen, so keep the app window visible.
      if (!overlay.toolbar && win && !win.isDestroyed() && win.isMinimized()) win.restore()
      await sleep(200)
      if (activeSession?.id !== sessionId) throw new Error('Recording startup was cancelled')

      return recordingStartOutputSchema.parse({ filePath, sessionId })
    } catch (error) {
      if (activeSession?.id === sessionId) {
        closeAnnotationOverlay()
        if (fileStarted) {
          activeSession.discardPromise ??= discardActiveRecording()
          await activeSession.discardPromise
        }
        activeSession.detachLifecycle()
        activeSession = undefined
      }
      if (win && !win.isDestroyed() && win.isMinimized()) win.restore()
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.recordingChunk, async (event, input: unknown) => {
    validateSender(event)
    const chunk = recordingChunkInputSchema.parse(input)
    if (
      !activeSession ||
      activeSession.id !== chunk.sessionId ||
      activeSession.ownerId !== event.sender.id
    ) {
      throw new Error('Recording session is not valid')
    }
    return recordingChunkOutputSchema.parse(await appendRecordingChunk(chunk.data))
  })

  ipcMain.handle(IPC_CHANNELS.recordingStop, async (event, input: unknown) => {
    validateSender(event)
    const stop = recordingStopInputSchema.parse(input)
    if (
      !activeSession ||
      activeSession.id !== stop.sessionId ||
      activeSession.ownerId !== event.sender.id
    ) {
      throw new Error('Recording session is not valid')
    }
    const session = activeSession
    const win = BrowserWindow.fromWebContents(event.sender)
    try {
      const filePath = await stopRecordingFile(stop.mimeType, stop.discard === true)
      return recordingStopOutputSchema.parse({ filePath })
    } finally {
      session.detachLifecycle()
      if (activeSession?.id === session.id) activeSession = undefined
      setSelectedSourceId('')
      closeAnnotationOverlay()
      if (win && win.isMinimized()) {
        win.restore()
        win.focus()
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.overlaySetInteractive, (event, input: unknown) => {
    validateSender(event)
    if (!isAnnotationCanvasSender(event.sender.id)) {
      throw new Error('Only the annotation canvas can change interaction mode')
    }
    const { interactive } = overlaySetInteractiveInputSchema.parse(input)
    return overlaySetInteractiveOutputSchema.parse(setAnnotationInteractive(interactive))
  })

  ipcMain.handle(IPC_CHANNELS.overlayRequestStop, (event, input: unknown) => {
    validateSender(event)
    if (!isAnnotationOverlaySender(event.sender.id)) {
      throw new Error('Only the annotation overlay can request recording stop')
    }
    overlayRequestStopInputSchema.parse(input)
    return overlayRequestStopOutputSchema.parse(requestRecordingStop())
  })
  ipcMain.handle(IPC_CHANNELS.overlayCommand, (event, input: unknown) => {
    validateSender(event)
    if (!isAnnotationToolbarSender(event.sender.id)) {
      throw new Error('Only the annotation toolbar can send annotation commands')
    }
    const command = overlayCommandSchema.parse(input)
    return overlayCommandOutputSchema.parse(forwardOverlayCommand(command))
  })

  ipcMain.handle(IPC_CHANNELS.overlayReportHistory, (event, input: unknown) => {
    validateSender(event)
    if (!isAnnotationCanvasSender(event.sender.id)) {
      throw new Error('Only the annotation canvas can report history')
    }
    const state = overlayHistoryStateSchema.parse(input)
    return overlayReportHistoryOutputSchema.parse(forwardOverlayHistory(state))
  })

  ipcMain.handle(IPC_CHANNELS.overlaySaveScreenshot, async (event, input: unknown) => {
    validateSender(event)
    if (!isAnnotationToolbarSender(event.sender.id)) {
      throw new Error('Only the annotation toolbar can save screenshots')
    }
    overlaySaveScreenshotInputSchema.parse(input)
    return overlaySaveScreenshotOutputSchema.parse({ filePath: await saveAnnotationScreenshot() })
  })
}
