import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  screen,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import { captureExclusionMode, parseWindowsBuild } from '../windows/platformCaps'
import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import { release } from 'node:os'
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
  micCommandSchema,
  micCommandOutputSchema,
  micStateSchema,
  micStateOutputSchema,
  panelGetLayoutInputSchema,
  panelLayoutSchema,
  panelSetLayoutInputSchema,
  diagnosticsLogInputSchema,
  diagnosticsLogOutputSchema,
  diagnosticsGetInfoInputSchema,
  diagnosticsGetInfoOutputSchema,
  diagnosticsShowLogInputSchema,
  diagnosticsShowLogOutputSchema,
  diagnosticsProbeFileInputSchema,
  diagnosticsProbeFileOutputSchema,
  type Settings
} from '../../shared/ipc-schemas'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { detectAudioTrack } from '../../shared/containerProbe'
import { isProbePathAllowed } from './probePath'
import { getLogPath, log } from '../logger'
import { BUILD_COMMIT } from '../buildInfo'
import {
  appendRecordingChunk,
  discardActiveRecording,
  getLastSavedRecordingPath,
  setSelectedSourceId,
  startRecordingFile,
  stopRecordingFile
} from '../recording'
import {
  closeAnnotationOverlay,
  forwardOverlayCommand,
  forwardMicCommand,
  forwardMicState,
  forwardOverlayHistory,
  getPanelLayout,
  isRecordingOwnerSender,
  raiseAnnotationPanel,
  setPanelLayout,
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

      // Open the annotation windows first so the main window only hides when the panel is usable.
      const overlay = await openAnnotationOverlay(
        source.display_id,
        source.id,
        owner,
        recording.saveDir
      )
      if (activeSession?.id !== sessionId) throw new Error('Recording startup was cancelled')
      if (overlay.toolbar) {
        if (win && !win.isDestroyed() && !win.isMinimized()) {
          win.minimize()
          await sleep(300)
        }
        raiseAnnotationPanel()
      } else {
        log(
          'error',
          `Annotation panel unavailable, the main window stays visible: ${overlay.error}`
        )
        if (win && !win.isDestroyed() && win.isMinimized()) win.restore()
      }
      await sleep(200)
      if (activeSession?.id !== sessionId) throw new Error('Recording startup was cancelled')

      return recordingStartOutputSchema.parse({ filePath, sessionId, overlay })
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

  ipcMain.handle(IPC_CHANNELS.panelMicCommand, (event, input: unknown) => {
    validateSender(event)
    if (!isAnnotationToolbarSender(event.sender.id)) {
      throw new Error('Only the annotation panel can send microphone commands')
    }
    const command = micCommandSchema.parse(input)
    return micCommandOutputSchema.parse(forwardMicCommand(command))
  })

  ipcMain.handle(IPC_CHANNELS.recordingMicState, (event, input: unknown) => {
    validateSender(event)
    if (!isRecordingOwnerSender(event.sender.id)) {
      throw new Error('Only the recording window can publish microphone state')
    }
    const state = micStateSchema.parse(input)
    return micStateOutputSchema.parse(forwardMicState(state))
  })

  ipcMain.handle(IPC_CHANNELS.panelGetLayout, (event, input: unknown) => {
    validateSender(event)
    if (!isAnnotationToolbarSender(event.sender.id)) {
      throw new Error('Only the annotation panel can read the panel layout')
    }
    panelGetLayoutInputSchema.parse(input)
    return panelLayoutSchema.parse(getPanelLayout())
  })

  ipcMain.handle(IPC_CHANNELS.panelSetLayout, (event, input: unknown) => {
    validateSender(event)
    if (!isAnnotationToolbarSender(event.sender.id)) {
      throw new Error('Only the annotation panel can change the panel layout')
    }
    const request = panelSetLayoutInputSchema.parse(input)
    return panelLayoutSchema.parse(setPanelLayout(request))
  })

  ipcMain.handle(IPC_CHANNELS.diagnosticsLog, (event, input: unknown) => {
    validateSender(event)
    const { line } = diagnosticsLogInputSchema.parse(input)
    log('info', `[renderer] ${line}`)
    return diagnosticsLogOutputSchema.parse(true)
  })

  ipcMain.handle(IPC_CHANNELS.diagnosticsGetInfo, (event, input: unknown) => {
    validateSender(event)
    diagnosticsGetInfoInputSchema.parse(input)
    return diagnosticsGetInfoOutputSchema.parse({
      logPath: getLogPath(),
      version: app.getVersion(),
      commit: BUILD_COMMIT,
      platform: process.platform,
      osRelease: release(),
      windowsBuild: process.platform === 'win32' ? parseWindowsBuild(release()) : null,
      captureMode: captureExclusionMode(process.platform, release())
    })
  })

  ipcMain.handle(IPC_CHANNELS.diagnosticsShowLog, (event, input: unknown) => {
    validateSender(event)
    diagnosticsShowLogInputSchema.parse(input)
    shell.showItemInFolder(getLogPath())
    return diagnosticsShowLogOutputSchema.parse(true)
  })

  ipcMain.handle(IPC_CHANNELS.diagnosticsProbeFile, async (event, input: unknown) => {
    validateSender(event)
    const { filePath } = diagnosticsProbeFileInputSchema.parse(input)
    if (!isProbePathAllowed(filePath, getLastSavedRecordingPath())) {
      throw new Error('Only the most recently saved recording can be checked')
    }
    const handle = await open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(256 * 1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const mime = /\.webm$/i.test(filePath) ? 'video/webm' : 'video/mp4'
      const result = detectAudioTrack(new Uint8Array(buffer.subarray(0, bytesRead)), mime)
      log('info', `Saved file audio check: ${result} (${filePath})`)
      return diagnosticsProbeFileOutputSchema.parse(result)
    } finally {
      await handle.close()
    }
  })
}
