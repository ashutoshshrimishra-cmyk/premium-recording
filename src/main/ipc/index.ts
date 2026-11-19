import {
  desktopCapturer,
  dialog,
  ipcMain,
  screen,
  type IpcMainInvokeEvent
} from 'electron'
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
  type Settings
} from '../../shared/ipc-schemas'
import { IPC_CHANNELS } from '../../shared/ipc-channels'

const settingsDefaults: Settings = {
  saveDir: 'Videos/MyRecorder',
  fps: 30,
  resolution: '1080p',
  noiseSuppression: true
}

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
      saveDir: store.get('saveDir', settingsDefaults.saveDir),
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
}
