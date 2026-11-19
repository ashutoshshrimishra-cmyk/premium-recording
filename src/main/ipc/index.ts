import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  screen,
  type IpcMainInvokeEvent
} from 'electron'
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
  type Settings
} from '../../shared/ipc-schemas'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import {
  appendRecordingChunk,
  setSelectedSourceId,
  startRecordingFile,
  stopRecordingFile
} from '../recording'

function getSettingsDefaults(): Settings {
  return {
    saveDir: join(app.getPath('videos'), 'MyRecorder'),
    fps: 30,
    resolution: '1080p',
    noiseSuppression: true
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function isFromOwnApp(event: IpcMainInvokeEvent): boolean {
  const frameUrl = event.senderFrame?.url
  if (!frameUrl) return false

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
  if (!isFromOwnApp(event)) {
    throw new Error('IPC request blocked: untrusted sender')
  }
}

export function registerIpc(): void {
  const settingsDefaults = getSettingsDefaults()
  const store = new Store<Settings>({
    name: 'settings',
    defaults: settingsDefaults
  })

  ipcMain.handle(IPC_CHANNELS.getSources, async (event, input: unknown) => {
    validateSender(event)
    getSourcesInputSchema.parse(input)

    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false
    })

    const result = sources.map((source) => ({
      id: source.id,
      name: source.name,
      displayId: source.display_id,
      thumbnail: source.thumbnail.toDataURL()
    }))

    return getSourcesOutputSchema.parse(result)
  })

  ipcMain.handle(IPC_CHANNELS.getDisplays, (event, input: unknown) => {
    validateSender(event)
    getDisplaysInputSchema.parse(input)

    const result = screen.getAllDisplays().map((display) => ({
      id: String(display.id),
      bounds: {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height
      },
      scaleFactor: display.scaleFactor
    }))

    return getDisplaysOutputSchema.parse(result)
  })

  ipcMain.handle(IPC_CHANNELS.pickFolder, async (event, input: unknown) => {
    validateSender(event)
    pickFolderInputSchema.parse(input)

    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })

    const selected = result.canceled ? null : (result.filePaths[0] ?? null)
    return pickFolderOutputSchema.parse(selected)
  })

  ipcMain.handle(IPC_CHANNELS.getSettings, (event, input: unknown) => {
    validateSender(event)
    getSettingsInputSchema.parse(input)

    const result: Settings = {
      // A relative path (old default 'Videos/MyRecorder') would resolve against the process cwd.
      saveDir: ((saved: string): string => (isAbsolute(saved) ? saved : settingsDefaults.saveDir))(
        store.get('saveDir', settingsDefaults.saveDir)
      ),
      fps: store.get('fps', settingsDefaults.fps),
      resolution: store.get('resolution', settingsDefaults.resolution),
      noiseSuppression: store.get('noiseSuppression', settingsDefaults.noiseSuppression)
    }

    return getSettingsOutputSchema.parse(result)
  })

  ipcMain.handle(IPC_CHANNELS.setSettings, (event, input: unknown) => {
    validateSender(event)
    const settings = setSettingsInputSchema.parse(input)
    store.set(settings)
    return setSettingsOutputSchema.parse(settings)
  })

  ipcMain.handle(IPC_CHANNELS.recordingSelectSource, (event, input: unknown) => {
    validateSender(event)
    const { sourceId } = recordingSelectSourceInputSchema.parse(input)
    setSelectedSourceId(sourceId)
    return recordingSelectSourceOutputSchema.parse(true)
  })

  ipcMain.handle(IPC_CHANNELS.recordingStart, async (event, input: unknown) => {
    validateSender(event)
    const recording = recordingStartInputSchema.parse(input)
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
      fetchWindowIcons: false
    })
    if (!sources.some((source) => source.id === recording.sourceId)) {
      throw new Error('No source selected')
    }
    setSelectedSourceId(recording.sourceId)
    const filePath = await startRecordingFile(recording.saveDir, new Date(), recording.mimeType)
    // Get our own window out of the recording.
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isMinimized()) {
      win.minimize()
      await sleep(500)
    }
    return recordingStartOutputSchema.parse({ filePath })
  })

  ipcMain.handle(IPC_CHANNELS.recordingChunk, async (event, input: unknown) => {
    validateSender(event)
    const chunk = recordingChunkInputSchema.parse(input)
    return recordingChunkOutputSchema.parse(await appendRecordingChunk(chunk))
  })

  ipcMain.handle(IPC_CHANNELS.recordingStop, async (event, input: unknown) => {
    validateSender(event)
    const stop = recordingStopInputSchema.parse(input)
    const win = BrowserWindow.fromWebContents(event.sender)
    try {
      const filePath = await stopRecordingFile(stop.mimeType, stop.discard === true)
      return recordingStopOutputSchema.parse({ filePath })
    } finally {
      setSelectedSourceId('')
      if (win && win.isMinimized()) win.restore()
    }
  })
}
