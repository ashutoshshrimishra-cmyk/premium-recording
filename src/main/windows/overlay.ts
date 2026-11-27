import {
  app,
  BrowserWindow,
  desktopCapturer,
  screen,
  type Display,
  type WebContents
} from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { release } from 'node:os'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import Store from 'electron-store'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type {
  MicCommand,
  MicState,
  OverlayCommand,
  OverlayHistoryState,
  PanelLayout
} from '../../shared/ipc-schemas'
import { screenshotFileName } from '../screenshotName'
import { log } from '../logger'
import { startCursorHook, stopCursorHook } from '../cursorHook'
import {
  displayChangeAction,
  isPointInRect,
  nextCursorPollDelay,
  sameSample,
  toDisplayRelative,
  type CursorSample
} from './cursorMath'
import { LOAD_ATTEMPTS, LOAD_TIMEOUT_MS, loadWithRetry, withTimeout } from './loadPolicy'
import { isSenderOf } from './senderGate'
import { panelProtectionPlan } from './platformCaps'
import {
  clampToDisplays,
  dockBounds,
  panelSize,
  resizeKeepingEdge,
  resolveDisplay,
  PANEL_EXPANDED_WIDTH,
  PANEL_TOOLS_WIDTH,
  type PanelDock,
  type Rect
} from './panelLayout'

const DEFAULT_DOCK: PanelDock = 'right'

interface PanelPrefs {
  dock: PanelDock
  x?: number
  y?: number
}

export interface OverlayOpenResult {
  canvas: boolean
  toolbar: boolean
  error?: string
}

let canvasWindow: BrowserWindow | undefined
let toolbarWindow: BrowserWindow | undefined
let recordingOwner: WebContents | undefined
let overlayDisplay: Display | undefined
let screenshotDir: string | undefined
let interactive = true
let panelDock: PanelDock = DEFAULT_DOCK
let panelExpanded = false
let panelStore: Store<PanelPrefs> | undefined
let cursorTimer: ReturnType<typeof setTimeout> | undefined
let lastCursor: CursorSample | undefined
let panelSaveTimer: ReturnType<typeof setTimeout> | undefined

function getPanelStore(): Store<PanelPrefs> {
  panelStore ??= new Store<PanelPrefs>({ name: 'overlay-panel', defaults: { dock: DEFAULT_DOCK } })
  return panelStore
}

function workAreas(): Rect[] {
  return screen.getAllDisplays().map((display) => ({ ...display.workArea }))
}

function isAlive(win: BrowserWindow | undefined): win is BrowserWindow {
  return Boolean(win && !win.isDestroyed())
}

/** Safe to call any number of times. */
function stopCursorFeed(): void {
  if (cursorTimer) clearTimeout(cursorTimer)
  cursorTimer = undefined
  lastCursor = undefined
  stopCursorHook()
}

/**
 * Polls the pointer and pushes display relative positions to the canvas when they change. The
 * display is read on every poll, so a display metrics change only needs to update overlayDisplay.
 */
function startCursorFeed(): void {
  stopCursorFeed()
  let lastMoveAt = Date.now()
  const poll = (): void => {
    cursorTimer = undefined
    const win = canvasWindow
    const display = overlayDisplay
    if (!isAlive(win) || !display) {
      stopCursorFeed()
      return
    }
    try {
      const now = Date.now()
      const sample = toDisplayRelative(screen.getCursorScreenPoint(), display.bounds)
      if (!sameSample(lastCursor, sample)) {
        lastCursor = sample
        lastMoveAt = now
        win.webContents.send(IPC_CHANNELS.overlayCursor, sample)
      }
      cursorTimer = setTimeout(poll, nextCursorPollDelay(now - lastMoveAt))
    } catch (error) {
      log('warn', 'Cursor polling failed', error)
      stopCursorFeed()
    }
  }
  cursorTimer = setTimeout(poll, nextCursorPollDelay(0))
  startCursorHook((click) => {
    const win = canvasWindow
    const display = overlayDisplay
    if (!isAlive(win) || !display) return
    try {
      // The hook reports physical pixels on Windows.
      const dip = process.platform === 'win32' ? screen.screenToDipPoint(click) : click
      if (isAlive(toolbarWindow) && isPointInRect(dip, toolbarWindow.getBounds())) return
      const sample = toDisplayRelative(dip, display.bounds)
      if (sample.inside) {
        win.webContents.send(IPC_CHANNELS.overlayClick, {
          x: sample.x,
          y: sample.y,
          button: click.button
        })
      }
    } catch (error) {
      log('warn', 'Could not forward a click', error)
    }
  })
}

function sendInteractiveState(): void {
  for (const win of [canvasWindow, toolbarWindow]) {
    if (isAlive(win)) win.webContents.send(IPC_CHANNELS.overlayInteractiveChanged, interactive)
  }
}

function keepToolbarOnTop(): void {
  if (isAlive(toolbarWindow)) toolbarWindow.moveTop()
}

/**
 * Loads a renderer view. Rejects when the load fails, the renderer process dies or nothing
 * finished within the timeout, and logs every failure.
 */
async function loadView(win: BrowserWindow, view: 'overlay' | 'toolbar'): Promise<void> {
  const attempt = async (): Promise<void> => {
    let fail: (error: Error) => void = () => undefined
    const failure = new Promise<never>((_resolve, reject) => {
      fail = reject
    })
    failure.catch(() => undefined)
    const onFailLoad = (
      _event: unknown,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean
    ): void => {
      if (!isMainFrame || errorCode === -3) return
      fail(
        new Error(
          `The ${view} window failed to load (${errorCode} ${errorDescription}) ${validatedURL}`
        )
      )
    }
    const onGone = (_event: unknown, details: { reason: string }): void =>
      fail(new Error(`The ${view} renderer process ended (${details.reason})`))
    win.webContents.on('did-fail-load', onFailLoad)
    win.webContents.on('render-process-gone', onGone)
    const load = (async (): Promise<void> => {
      if (is.dev && process.env.ELECTRON_RENDERER_URL) {
        const url = new URL(process.env.ELECTRON_RENDERER_URL)
        url.searchParams.set('view', view)
        await win.loadURL(url.toString())
      } else {
        await win.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } })
      }
    })()
    load.catch(() => undefined)
    try {
      await withTimeout(
        Promise.race([load, failure]),
        LOAD_TIMEOUT_MS,
        `The ${view} window did not load within ${LOAD_TIMEOUT_MS} ms`
      )
    } finally {
      if (!win.isDestroyed()) {
        win.webContents.removeListener('did-fail-load', onFailLoad)
        win.webContents.removeListener('render-process-gone', onGone)
      }
    }
  }
  await loadWithRetry(
    async () => {
      if (win.isDestroyed()) throw new Error(`The ${view} window was closed while loading`)
      await attempt()
    },
    LOAD_ATTEMPTS,
    (error) => log('warn', `Loading the ${view} window failed, retrying`, error)
  )
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
    // An unexpected close (not closeAnnotationOverlay) must also stop the poll and the global hook.
    if (canvasWindow !== win) return
    canvasWindow = undefined
    log('warn', 'The annotation canvas closed unexpectedly')
    stopCursorFeed()
  })
  // Clicking the canvas raises it; keep the toolbar above it.
  win.on('focus', keepToolbarOnTop)
  await loadView(win, 'overlay')
  if (win.isDestroyed()) throw new Error('Annotation canvas closed before it was ready')
  win.show()
}

function restorePanelBounds(display: Display, dock: PanelDock): Rect {
  const size = panelSize(dock, panelExpanded, display.workArea)
  const docked = dockBounds(display.workArea, dock, size)
  const saved = getPanelStore().store
  if (saved.dock === dock && typeof saved.x === 'number' && typeof saved.y === 'number') {
    return clampToDisplays({ ...docked, x: saved.x, y: saved.y }, workAreas())
  }
  return docked
}

function savePanelPrefsSoon(): void {
  if (panelSaveTimer) clearTimeout(panelSaveTimer)
  panelSaveTimer = setTimeout(() => {
    panelSaveTimer = undefined
    if (!isAlive(toolbarWindow)) return
    try {
      const { x, y } = toolbarWindow.getBounds()
      getPanelStore().set({ dock: panelDock, x, y })
    } catch (error) {
      log('warn', 'Could not save the annotation panel position', error)
    }
  }, 400)
}

async function openToolbarWindow(display: Display): Promise<void> {
  const stored = getPanelStore().get('dock')
  panelDock = stored === 'left' || stored === 'top' || stored === 'bottom' ? stored : DEFAULT_DOCK
  panelExpanded = false
  const bounds = restorePanelBounds(display, panelDock)
  const win = new BrowserWindow({
    ...bounds,
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
    title: 'Annotation panel',
    webPreferences: sharedWebPreferences
  })
  toolbarWindow = win
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Old Windows builds paint protected windows black, so there the panel stays unprotected and visible.
  const plan = panelProtectionPlan(process.platform, release())
  if (plan.protect) win.setContentProtection(true)
  log(plan.logLevel, plan.message)
  win.on('closed', () => {
    if (toolbarWindow !== win) return
    toolbarWindow = undefined
    log('warn', 'The annotation panel closed unexpectedly')
    // Without the panel there is no way back to mouse mode, so the canvas must not block the desktop.
    if (isAlive(canvasWindow) && interactive) {
      interactive = false
      canvasWindow.setIgnoreMouseEvents(true, { forward: true })
      sendInteractiveState()
    }
  })
  win.on('moved', savePanelPrefsSoon)
  await loadView(win, 'toolbar')
  if (win.isDestroyed()) throw new Error('Annotation panel closed before it was ready')
  win.showInactive()
  win.moveTop()
}

/** Raises the panel above every other window, for example after the main window was minimized. */
export function raiseAnnotationPanel(): void {
  if (isAlive(toolbarWindow)) {
    toolbarWindow.setAlwaysOnTop(true, 'screen-saver')
    toolbarWindow.moveTop()
  }
}

export function getPanelLayout(): PanelLayout {
  return { dock: panelDock, expanded: panelExpanded }
}

/** Docks the panel to another edge and/or widens it for the options sections. */
export function setPanelLayout(request: { dock?: PanelDock; expanded?: boolean }): PanelLayout {
  const win = toolbarWindow
  if (!isAlive(win)) throw new Error('The annotation panel is not running')
  const nextDock = request.dock ?? panelDock
  const nextExpanded = request.expanded ?? panelExpanded
  const current = win.getBounds()
  const display = screen.getDisplayMatching(current)
  let next: Rect
  if (nextDock !== panelDock) {
    const size = panelSize(nextDock, nextExpanded, display.workArea)
    next = dockBounds(display.workArea, nextDock, size)
  } else if (nextExpanded !== panelExpanded && (nextDock === 'left' || nextDock === 'right')) {
    const width = nextExpanded ? PANEL_EXPANDED_WIDTH : PANEL_TOOLS_WIDTH
    next = clampToDisplays(resizeKeepingEdge(current, width, nextDock), workAreas())
  } else {
    next = current
  }
  panelDock = nextDock
  panelExpanded = nextExpanded
  win.setBounds(next)
  win.moveTop()
  savePanelPrefsSoon()
  return getPanelLayout()
}

/**
 * Opens the capture canvas and the annotation panel. A failure of either window is logged and does
 * not stop the recording. Reports which windows are available and why one failed.
 */
export async function openAnnotationOverlay(
  sourceDisplayId: string,
  sourceId: string,
  owner: WebContents,
  saveDir: string,
  withCanvas = true
): Promise<OverlayOpenResult> {
  closeAnnotationOverlay()

  const displays = screen.getAllDisplays()
  const display = resolveDisplay(sourceDisplayId, sourceId, displays, screen.getPrimaryDisplay())
  if (!display) {
    const error = 'No display is available for the annotation tools'
    log('error', `${error} (display_id '${sourceDisplayId}', source '${sourceId}')`)
    return { canvas: false, toolbar: false, error }
  }
  log(
    'info',
    `Annotation display ${display.id} chosen for display_id '${sourceDisplayId}', source '${sourceId}' (${displays.length} displays)`
  )

  recordingOwner = owner
  overlayDisplay = display
  screenshotDir = saveDir
  interactive = true
  const errors: string[] = []

  try {
    if (withCanvas) await openCanvasWindow(display)
  } catch (error) {
    log('error', 'Could not open the annotation canvas', error)
    errors.push(`canvas: ${error instanceof Error ? error.message : String(error)}`)
    if (isAlive(canvasWindow)) canvasWindow.destroy()
    canvasWindow = undefined
  }

  try {
    await openToolbarWindow(display)
  } catch (error) {
    log('error', 'Could not open the annotation panel', error)
    errors.push(`panel: ${error instanceof Error ? error.message : String(error)}`)
    if (isAlive(toolbarWindow)) toolbarWindow.destroy()
    toolbarWindow = undefined
  }

  const toolbar = isAlive(toolbarWindow)
  // Without the panel the canvas must not block the desktop.
  if (!toolbar && isAlive(canvasWindow)) {
    interactive = false
    canvasWindow.setIgnoreMouseEvents(true, { forward: true })
  }
  if (isAlive(canvasWindow)) startCursorFeed()
  watchDisplays()
  sendInteractiveState()
  const result: OverlayOpenResult = { canvas: isAlive(canvasWindow), toolbar }
  if (errors.length > 0) result.error = errors.join('; ').slice(0, 500)
  log('info', `Annotation overlay result: ${JSON.stringify(result)}`)
  return result
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
  return isSenderOf(canvasWindow?.webContents, senderId) && isAlive(canvasWindow)
}

export function isAnnotationToolbarSender(senderId: number): boolean {
  return isSenderOf(toolbarWindow?.webContents, senderId) && isAlive(toolbarWindow)
}

export function isRecordingOwnerSender(senderId: number): boolean {
  return isSenderOf(recordingOwner, senderId)
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

/** Panel to recording window. */
export function forwardMicCommand(command: MicCommand): boolean {
  if (!recordingOwner || recordingOwner.isDestroyed()) return false
  recordingOwner.send(IPC_CHANNELS.recordingMicCommand, command)
  return true
}

/** Recording window to panel. */
export function forwardMicState(state: MicState): boolean {
  if (!isAlive(toolbarWindow)) return false
  toolbarWindow.webContents.send(IPC_CHANNELS.panelMicState, state)
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

function keepPanelOnScreen(): void {
  if (!isAlive(toolbarWindow)) return
  try {
    const current = toolbarWindow.getBounds()
    const next = clampToDisplays(current, workAreas())
    if (next.x !== current.x || next.y !== current.y || next.width !== current.width) {
      toolbarWindow.setBounds(next)
    }
    toolbarWindow.moveTop()
  } catch (error) {
    log('warn', 'Could not keep the annotation panel on screen', error)
  }
}

function onDisplayMetricsChanged(_event: unknown, display: Display): void {
  if (displayChangeAction(overlayDisplay?.id, display.id, 'metrics') === 'resize') {
    log('info', `Recorded display ${display.id} changed, resizing the annotation canvas`)
    overlayDisplay = display
    lastCursor = undefined
    if (isAlive(canvasWindow)) canvasWindow.setBounds(display.bounds)
  }
  keepPanelOnScreen()
}

function onDisplayRemoved(_event: unknown, display: Display): void {
  if (displayChangeAction(overlayDisplay?.id, display.id, 'removed') === 'close-canvas') {
    log('warn', `Recorded display ${display.id} was removed, closing the annotation canvas`)
    stopCursorFeed()
    const canvas = canvasWindow
    canvasWindow = undefined
    if (isAlive(canvas)) canvas.destroy()
    overlayDisplay = undefined
    // The capture ends with the display; bring the main window back so the result is visible.
    const owner = recordingOwner && !recordingOwner.isDestroyed() ? recordingOwner : undefined
    const ownerWindow = owner ? BrowserWindow.fromWebContents(owner) : null
    if (ownerWindow && !ownerWindow.isDestroyed() && ownerWindow.isMinimized()) {
      ownerWindow.restore()
    }
  }
  keepPanelOnScreen()
}

let watchingDisplays = false

function watchDisplays(): void {
  if (watchingDisplays) return
  watchingDisplays = true
  screen.on('display-metrics-changed', onDisplayMetricsChanged)
  screen.on('display-removed', onDisplayRemoved)
}

function unwatchDisplays(): void {
  if (!watchingDisplays) return
  watchingDisplays = false
  screen.removeListener('display-metrics-changed', onDisplayMetricsChanged)
  screen.removeListener('display-removed', onDisplayRemoved)
}

/** Safe to call any number of times. */
export function closeAnnotationOverlay(): void {
  stopCursorFeed()
  unwatchDisplays()
  const windows = [canvasWindow, toolbarWindow]
  if (panelSaveTimer && isAlive(toolbarWindow)) {
    // Persist a pending position before the window goes away.
    const { x, y } = toolbarWindow.getBounds()
    try {
      getPanelStore().set({ dock: panelDock, x, y })
    } catch {
      // Not critical.
    }
  }
  if (panelSaveTimer) clearTimeout(panelSaveTimer)
  panelSaveTimer = undefined
  panelExpanded = false
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
