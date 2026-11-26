import { BrowserWindow, globalShortcut, screen, type WebContents } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '../../shared/ipc-channels'

let overlayWindow: BrowserWindow | undefined
let recordingOwner: WebContents | undefined
let interactive = true
let annotationShortcutAvailable = false

function sendInteractiveState(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send(IPC_CHANNELS.overlayInteractiveChanged, interactive)
  }
}

export async function openAnnotationOverlay(
  displayId: string,
  owner: WebContents
): Promise<void> {
  closeAnnotationOverlay()

  const display = screen.getAllDisplays().find((candidate) => String(candidate.id) === displayId)
  if (!display) {
    throw new Error('The selected screen could not be mapped to an annotation display')
  }

  recordingOwner = owner
  interactive = true
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
    webPreferences: {
      preload: join(__dirname, '../../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  overlayWindow = win
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.on('closed', () => {
    if (overlayWindow === win) overlayWindow = undefined
  })
  win.webContents.once('render-process-gone', () => {
    if (overlayWindow === win) requestRecordingStop()
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    url.searchParams.set('view', 'overlay')
    await win.loadURL(url.toString())
  } else {
    // Match the main window's packaged renderer path: out/main -> out/renderer.
    await win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { view: 'overlay' }
    })
  }

  if (win.isDestroyed()) throw new Error('Annotation overlay closed before it was ready')
  win.show()
  win.focus()
  sendInteractiveState()
}

export function setAnnotationInteractive(nextInteractive: boolean): boolean {
  const win = overlayWindow
  if (!win || win.isDestroyed()) throw new Error('Annotation overlay is not running')
  if (!nextInteractive && !annotationShortcutAvailable) {
    throw new Error('Desktop mode is unavailable because Ctrl/Cmd+Shift+A is already in use')
  }
  interactive = nextInteractive
  win.setIgnoreMouseEvents(!interactive, { forward: true })
  if (interactive) {
    win.show()
    win.focus()
  }
  sendInteractiveState()
  return interactive
}

export function toggleAnnotationInteractive(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  setAnnotationInteractive(!interactive)
}

export function isAnnotationOverlaySender(senderId: number): boolean {
  return Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.webContents.id === senderId)
}

export function closeAnnotationOverlay(): void {
  const win = overlayWindow
  overlayWindow = undefined
  interactive = true
  if (win && !win.isDestroyed()) win.destroy()
  recordingOwner = undefined
}

export function requestRecordingStop(): boolean {
  if (!recordingOwner || recordingOwner.isDestroyed()) return false
  recordingOwner.send(IPC_CHANNELS.recordingStopRequested)
  return true
}

export function registerOverlayShortcuts(): void {
  annotationShortcutAvailable = globalShortcut.register('CommandOrControl+Shift+A', () => {
    toggleAnnotationInteractive()
  })
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    requestRecordingStop()
  })
}

export function unregisterOverlayShortcuts(): void {
  globalShortcut.unregister('CommandOrControl+Shift+A')
  globalShortcut.unregister('CommandOrControl+Shift+S')
  annotationShortcutAvailable = false
}
