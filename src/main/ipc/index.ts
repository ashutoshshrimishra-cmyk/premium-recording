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
import { displayLabel, matchDisplay, sortDisplays, sourceKindOf } from '../../shared/sourceId'
import { captureExclusionMode, parseWindowsBuild } from '../windows/platformCaps'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'
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
  settingsSchema,
  shortcutsGetInputSchema,
  shortcutsSetInputSchema,
  shortcutsResultSchema,
  shortcutsSuspendInputSchema,
  shortcutsSuspendOutputSchema,
  recentListInputSchema,
  recentListOutputSchema,
  recentAddInputSchema,
  recentPathInputSchema,
  recentActionOutputSchema,
  type RecentRecording,
  type Settings,
  type ShortcutFailure,
  type ShortcutsConfig
} from '../../shared/ipc-schemas'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { detectAudioTrack } from '../../shared/containerProbe'
import { addRecent, pruneMissing } from '../../shared/recentRecordings'
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  findDuplicates,
  validateAccelerator
} from '../../shared/shortcuts'
import { applyShortcuts, getShortcutFailures, suspendShortcuts } from '../shortcuts/shortcutManager'
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
    audioDeviceId: 'default',
    countdownSeconds: 3,
    openFolderAfterSave: false,
    cursorEffect: true,
    annotationStartsActive: true,
    shortcuts: { ...DEFAULT_SHORTCUTS }
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
    const { kind } = getSourcesInputSchema.parse(input)
    const sources = await desktopCapturer.getSources({
      types: [kind],
      thumbnailSize: kind === 'screen' ? { width: 320, height: 180 } : { width: 320, height: 200 },
      fetchWindowIcons: false
    })
    if (kind === 'window') {
      return getSourcesOutputSchema.parse(
        sources
          .filter((source) => source.name.trim().length > 0 && !source.thumbnail.isEmpty())
          .map((source) => ({
            id: source.id,
            name: source.name,
            displayId: source.display_id,
            kind,
            label: source.name,
            thumbnail: source.thumbnail.toDataURL()
          }))
      )
    }
    const displays = screen.getAllDisplays()
    const primaryId = screen.getPrimaryDisplay().id
    const ordered = sortDisplays(displays, primaryId)
    const entries = sources.map((source) => {
      const display = matchDisplay(source.display_id, source.id, displays)
      const position = display ? ordered.findIndex((item) => item.id === display.id) + 1 : 0
      return { source, display, position }
    })
    entries.sort((a, b) => (a.position || 99) - (b.position || 99))
    return getSourcesOutputSchema.parse(
      entries.map(({ source, display, position }) => ({
        id: source.id,
        name: source.name,
        displayId: source.display_id || (display ? String(display.id) : ''),
        kind,
        label: display
          ? displayLabel(
              position,
              display.bounds.width * display.scaleFactor,
              display.bounds.height * display.scaleFactor,
              display.id === primaryId
            )
          : source.name,
        bounds: display ? { ...display.bounds } : undefined,
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

  const readSettings = (): Settings => {
    const saved = store.get('saveDir', settingsDefaults.saveDir)
    const raw = {
      saveDir: isAbsolute(saved) ? saved : settingsDefaults.saveDir,
      fps: store.get('fps', settingsDefaults.fps),
      resolution: store.get('resolution', settingsDefaults.resolution),
      noiseSuppression: store.get('noiseSuppression', settingsDefaults.noiseSuppression),
      audioDeviceId: store.get('audioDeviceId', 'default') || 'default',
      countdownSeconds: store.get('countdownSeconds', settingsDefaults.countdownSeconds),
      openFolderAfterSave: store.get('openFolderAfterSave', settingsDefaults.openFolderAfterSave),
      cursorEffect: store.get('cursorEffect', settingsDefaults.cursorEffect),
      annotationStartsActive: store.get(
        'annotationStartsActive',
        settingsDefaults.annotationStartsActive
      ),
      shortcuts: store.get('shortcuts', settingsDefaults.shortcuts)
    }
    const parsed = settingsSchema.safeParse(raw)
    if (parsed.success) return parsed.data
    log('warn', 'Stored settings are invalid, using defaults', parsed.error)
    return settingsDefaults
  }

  const shortcutsResult = (shortcuts: ShortcutsConfig, failed: ShortcutFailure[]): unknown => ({
    ok: failed.length === 0,
    failed,
    shortcuts
  })

  // Registers the saved shortcuts at startup. Failures are reported to the settings screen later.
  applyShortcuts(readSettings().shortcuts)

  ipcMain.handle(IPC_CHANNELS.getSettings, (event, input: unknown) => {
    validateSender(event)
    getSettingsInputSchema.parse(input)
    return getSettingsOutputSchema.parse(readSettings())
  })

  ipcMain.handle(IPC_CHANNELS.setSettings, (event, input: unknown) => {
    validateSender(event)
    const settings = setSettingsInputSchema.parse(input)
    const previous = readSettings().shortcuts
    // Shortcuts are only changed through shortcutsSet, which validates them.
    store.set({
      ...settings,
      audioDeviceId: settings.audioDeviceId ?? 'default',
      shortcuts: previous
    })
    return setSettingsOutputSchema.parse({ ...settings, shortcuts: previous })
  })

  ipcMain.handle(IPC_CHANNELS.shortcutsGet, (event, input: unknown) => {
    validateSender(event)
    shortcutsGetInputSchema.parse(input)
    return shortcutsResultSchema.parse(
      shortcutsResult(readSettings().shortcuts, getShortcutFailures())
    )
  })

  ipcMain.handle(IPC_CHANNELS.shortcutsSet, (event, input: unknown) => {
    validateSender(event)
    const requested = shortcutsSetInputSchema.parse(input)
    const normalized = { ...requested }
    const failed: ShortcutFailure[] = []
    for (const action of SHORTCUT_ACTIONS) {
      const check = validateAccelerator(requested[action])
      if (check.valid && check.accelerator) normalized[action] = check.accelerator
      else
        failed.push({ action, accelerator: requested[action], reason: check.reason ?? 'Invalid' })
    }
    for (const group of findDuplicates(normalized)) {
      for (const action of group.actions.slice(1)) {
        failed.push({
          action,
          accelerator: normalized[action],
          reason: 'Already used by another action'
        })
      }
    }
    if (failed.length > 0) {
      // Nothing is saved when the input is invalid, the active shortcuts stay as they were.
      return shortcutsResultSchema.parse(shortcutsResult(readSettings().shortcuts, failed))
    }
    store.set('shortcuts', normalized)
    const registrationFailures = applyShortcuts(normalized)
    return shortcutsResultSchema.parse(shortcutsResult(normalized, registrationFailures))
  })

  ipcMain.handle(IPC_CHANNELS.shortcutsSuspend, (event, input: unknown) => {
    validateSender(event)
    const { suspended } = shortcutsSuspendInputSchema.parse(input)
    suspendShortcuts(suspended)
    return shortcutsSuspendOutputSchema.parse(true)
  })

  const recentStore = new Store<{ items: RecentRecording[] }>({
    name: 'recent-recordings',
    defaults: { items: [] }
  })
  const readRecent = (): RecentRecording[] => {
    const items = pruneMissing(recentStore.get('items', []), (filePath) => existsSync(filePath))
    recentStore.set('items', items)
    return items
  }

  ipcMain.handle(IPC_CHANNELS.recentList, (event, input: unknown) => {
    validateSender(event)
    recentListInputSchema.parse(input)
    return recentListOutputSchema.parse(readRecent())
  })

  ipcMain.handle(IPC_CHANNELS.recentAdd, async (event, input: unknown) => {
    validateSender(event)
    const { filePath, durationMs } = recentAddInputSchema.parse(input)
    // Only the file that was just saved can be added.
    if (filePath !== getLastSavedRecordingPath()) {
      throw new Error('Only the most recently saved recording can be added')
    }
    const { size } = await stat(filePath)
    const items = addRecent(readRecent(), {
      filePath,
      sizeBytes: size,
      durationMs,
      savedAt: new Date().toISOString()
    })
    recentStore.set('items', items)
    return recentListOutputSchema.parse(items)
  })

  const recentPath = (input: unknown): string => {
    const { filePath } = recentPathInputSchema.parse(input)
    if (!readRecent().some((item) => item.filePath === filePath)) {
      throw new Error('That recording is not in the recent list')
    }
    return filePath
  }

  ipcMain.handle(IPC_CHANNELS.recentOpen, async (event, input: unknown) => {
    validateSender(event)
    const error = await shell.openPath(recentPath(input))
    if (error) throw new Error(error)
    return recentActionOutputSchema.parse(true)
  })

  ipcMain.handle(IPC_CHANNELS.recentShow, (event, input: unknown) => {
    validateSender(event)
    shell.showItemInFolder(recentPath(input))
    return recentActionOutputSchema.parse(true)
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
        types: ['screen', 'window'],
        thumbnailSize: { width: 1, height: 1 },
        fetchWindowIcons: false
      })
      if (activeSession?.id !== sessionId) throw new Error('Recording startup was cancelled')
      const source = sources.find((candidate) => candidate.id === recording.sourceId)
      if (!source)
        throw new Error(
          'The selected screen or window is no longer available. Refresh the list and select it again.'
        )

      const filePath = await startRecordingFile(recording.saveDir, new Date(), recording.mimeType)
      fileStarted = true
      if (activeSession?.id !== sessionId) throw new Error('Recording startup was cancelled')

      // Open the annotation windows first so the main window only hides when the panel is usable.
      const overlay = await openAnnotationOverlay(
        source.display_id,
        source.id,
        owner,
        recording.saveDir,
        sourceKindOf(source.id) !== 'window'
      )
      if (activeSession?.id !== sessionId) throw new Error('Recording startup was cancelled')
      if (overlay.canvas && !readSettings().annotationStartsActive) {
        try {
          setAnnotationInteractive(false)
        } catch (error) {
          log('warn', 'Could not start in mouse mode', error)
        }
      }
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
