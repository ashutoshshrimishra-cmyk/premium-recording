import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  screen,
  type Display,
  type WebContents
} from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { OverlayCommand, OverlayHistoryState } from '../../shared/ipc-schemas'
import { screenshotFileName } from '../screenshotName'
import { log } from '../logger'

const TOOLBAR_MAX_WIDTH = 960
const TOOLBAR_HEIGHT = 132
const TOOLBAR_MARGIN = 12

let canvasWindow: BrowserWindow | undefined
let toolbarWindow: BrowserWindow | undefined
let recordingOwner: WebContents | undefined
let overlayDisplay: Display | undefined
let screenshotDir: string | undefined
let interactive = true

function isAlive(win: BrowserWindow | undefined): win is BrowserWindow {
  return Boolean(win && !win.isDestroyed())
}

function sendInteractiveState(): void {
  for (const win of [canvasWindow, toolbarWindow]) {
    if (isAlive(win)) win.webContents.send(IPC_CHANNELS.overlayInteractiveChanged, interactive)
  }
}

function keepToolbarOnTop(): void {
  if (isAlive(toolbarWindow)) toolbarWindow.moveTop()
}

async function loadView(win: BrowserWindow, view: 'overlay' | 'toolbar'): Promise<void> {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    url.searchParams.set('view', view)
    await win.loadURL(url.toString())
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } })
  }
}

const sharedWebPreferences = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  backgroundThrottling: false
}

async function openCanvasWindow(display: Display): Promise<void> {
  const win = new BrowserWindow({
    ...display.bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    autoHideMenuBar: true,
    webPreferences: sharedWebPreferences
  })
  canvasWindow = win
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.on('closed', () => {
    if (canvasWindow === win) canvasWindow = undefined
  })
  // Clicking the canvas raises it; keep the toolbar above it.
  win.on('focus', keepToolbarOnTop)
  await loadView(win, 'overlay')
  if (win.isDestroyed()) throw new Error('Annotation canvas closed before it was ready')
  win.show()
}

async function openToolbarWindow(display: Display): Promise<void> {
  const width = Math.min(TOOLBAR_MAX_WIDTH, display.bounds.width - TOOLBAR_MARGIN * 2)
  const win = new BrowserWindow({
    x: display.bounds.x + Math.round((display.bounds.width - width) / 2),
    y: display.bounds.y + TOOLBAR_MARGIN,
    width,
    height: TOOLBAR_HEIGHT,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#1b1c20',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: 'Annotation toolbar',
    webPreferences: sharedWebPreferences
  })
  toolbarWindow = win
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Keeps the toolbar out of the recording and out of screenshots.
  win.setContentProtection(true)
  win.on('closed', () => {
    if (toolbarWindow === win) toolbarWindow = undefined
  })
  await loadView(win, 'toolbar')
  if (win.isDestroyed()) throw new Error('Annotation toolbar closed before it was ready')
  win.show()
  win.moveTop()
}

/**
 * Opens the capture canvas and the toolbar. A failure of either window is logged and does not
 * stop the recording. Returns whether the toolbar is available.
 */
export async function openAnnotationOverlay(
  displayId: string,
  owner: WebContents,
  saveDir: string
): Promise<{ toolbar: boolean }> {
  closeAnnotationOverlay()

  const display = screen.getAllDisplays().find((candidate) => String(candidate.id) === displayId)
  if (!display) {
    log(
      'error',
      `The selected screen could not be mapped to an annotation display (id '${displayId}')`
    )
    return { toolbar: false }
  }

  recordingOwner = owner
  overlayDisplay = display
  screenshotDir = saveDir
  interactive = true

  try {
    await openCanvasWindow(display)
  } catch (error) {
    log('error', 'Could not open the annotation canvas', error)
    if (isAlive(canvasWindow)) canvasWindow.destroy()
    canvasWindow = undefined
  }

  try {
    await openToolbarWindow(display)
  } catch (error) {
    log('error', 'Could not open the annotation toolbar', error)
    if (isAlive(toolbarWindow)) toolbarWindow.destroy()
    toolbarWindow = undefined
  }

  sendInteractiveState()
  return { toolbar: isAlive(toolbarWindow) }
}

export function setAnnotationInteractive(nextInteractive: boolean): boolean {
  const win = canvasWindow
  if (!isAlive(win)) throw new Error('Annotation canvas is not running')
  interactive = nextInteractive
  win.setIgnoreMouseEvents(!interactive, { forward: true })
  keepToolbarOnTop()
  sendInteractiveState()
  return interactive
}

export function toggleAnnotationInteractive(): void {
  if (!isAlive(canvasWindow)) return
  setAnnotationInteractive(!interactive)
}

export function isAnnotationCanvasSender(senderId: number): boolean {
  return isAlive(canvasWindow) && canvasWindow.webContents.id === senderId
}

export function isAnnotationToolbarSender(senderId: number): boolean {
  return isAlive(toolbarWindow) && toolbarWindow.webContents.id === senderId
}

export function isAnnotationOverlaySender(senderId: number): boolean {
  return isAnnotationCanvasSender(senderId) || isAnnotationToolbarSender(senderId)
}

/** Toolbar to canvas. Switching tools also switches between drawing and desktop (mouse) mode. */
export function forwardOverlayCommand(command: OverlayCommand): boolean {
  if (!isAlive(canvasWindow)) return false
  if (command.type === 'tool') setAnnotationInteractive(command.tool !== 'mouse')
  canvasWindow.webContents.send(IPC_CHANNELS.overlayCommandReceived, command)
  return true
}

/** Canvas to toolbar. */
export function forwardOverlayHistory(state: OverlayHistoryState): boolean {
  if (!isAlive(toolbarWindow)) return false
  toolbarWindow.webContents.send(IPC_CHANNELS.overlayHistoryChanged, state)
  return true
}

async function writeScreenshot(png: Buffer): Promise<string> {
  const directories = [screenshotDir, app.getPath('pictures')].filter((dir): dir is string =>
    Boolean(dir)
  )
  let lastError: unknown
  for (const directory of directories) {
    try {
      await mkdir(directory, { recursive: true })
      const filePath = join(directory, screenshotFileName(new Date()))
      await writeFile(filePath, png)
      return filePath
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not write the screenshot')
}

/**
 * Captures the annotated display at full pixel size. The toolbar is excluded by content
 * protection, the canvas window (with the drawings) is included.
 */
export async function saveAnnotationScreenshot(): Promise<string> {
  const display = overlayDisplay
  if (!display) throw new Error('Annotation overlay is not running')
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.bounds.width * display.scaleFactor),
      height: Math.round(display.bounds.height * display.scaleFactor)
    },
    fetchWindowIcons: false
  })
  const source =
    sources.find((candidate) => candidate.display_id === String(display.id)) ??
    (sources.length === 1 ? sources[0] : undefined)
  if (!source || source.thumbnail.isEmpty()) throw new Error('The screen could not be captured')
  return writeScreenshot(source.thumbnail.toPNG())
}

export function closeAnnotationOverlay(): void {
  const windows = [canvasWindow, toolbarWindow]
  canvasWindow = undefined
  toolbarWindow = undefined
  interactive = true
  for (const win of windows) {
    if (isAlive(win)) win.destroy()
  }
  recordingOwner = undefined
  overlayDisplay = undefined
  screenshotDir = undefined
}

export function requestRecordingStop(): boolean {
  if (!recordingOwner || recordingOwner.isDestroyed()) return false
  recordingOwner.send(IPC_CHANNELS.recordingStopRequested)
  return true
}

export function registerOverlayShortcuts(): void {
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    toggleAnnotationInteractive()
  })
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    requestRecordingStop()
  })
}

export function unregisterOverlayShortcuts(): void {
  globalShortcut.unregister('CommandOrControl+Shift+A')
  globalShortcut.unregister('CommandOrControl+Shift+S')
}
