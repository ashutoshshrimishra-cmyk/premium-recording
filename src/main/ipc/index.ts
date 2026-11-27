import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  screen,
  shell,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { displayLabel, matchDisplay, sortDisplays, sourceKindOf } from '../../shared/sourceId'
import { captureExclusionMode, parseWindowsBuild } from '../windows/platformCaps'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { release } from 'node:os'
import { isAbsolute, join } from 'node:path'
import Store from 'electron-store'
import { is } from '@electron-toolkit/utils'
import { isTopLevelFrame, isTrustedRendererUrl, type TrustedRenderer } from './trustedSender'
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
  recoveryListInputSchema,
  recoveryListOutputSchema,
  recoveryPathInputSchema,
  recoveryRecoverOutputSchema,
  recoveryDiscardOutputSchema,
  type RecentRecording,
  type Settings,
  type ShortcutFailure,
  type ShortcutsConfig
} from '../../shared/ipc-schemas'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { detectAudioTrack } from '../../shared/containerProbe'
import { addRecent, pruneMissing, sanitizeRecent } from '../../shared/recentRecordings'
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
  closeActiveRecordingKeepingPart,
  discardActiveRecording,
  getActiveTempPath,
  getLastSavedRecordingPath,
  setSelectedSourceId,
  startRecordingFile,
  stopRecordingFile
} from '../recording'
import { toStopFailure } from '../recordingErrors'
import {
  isStartupCancelled,
  once,
  ownerLossTeardown,
  type FileTeardown,
  type SessionPhase
} from './sessionState'
import { deletePart, isRecoverablePartPath, listAbandonedParts, recoverPart } from '../recovery'
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
  type OverlayOpenResult,
  requestRecordingStop,
  saveAnnotationScreenshot,
  setAnnotationInteractive
} from '../windows/overlay'

interface ActiveRecordingSession {
  id: string
  ownerId: number
  phase: SessionPhase
  /** Set by the first teardown request. Startup checks it after every await. */
  tornDown: boolean
  /** The .part created for this session, once the file is open. */
  tempPath?: string
  /** Stops per-session timers such as the disk space monitor. */
  stopMonitors?: () => void
  /** The single teardown for this session. The first call decides what happens to the file. */
  end: (mode: FileTeardown) => Promise<void>
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

/** The pages allowed to use IPC: the bundled renderer, plus the dev server in development. */
export function trustedRenderer(): TrustedRenderer {
  return {
    indexHtmlPath: join(__dirname, '../renderer/index.html'),
    devServerUrl: is.dev ? process.env.ELECTRON_RENDERER_URL : undefined,
    platform: process.platform
  }
}

const blockedSenders = new Set<string>()

function isFromOwnApp(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  const frameUrl = frame?.url
  if (!frameUrl || !BrowserWindow.fromWebContents(event.sender)) return false
  if (isTopLevelFrame(frame) && isTrustedRendererUrl(frameUrl, trustedRenderer())) return true
  const key = `${isTopLevelFrame(frame) ? 'top' : 'subframe'} ${frameUrl.slice(0, 300)}`
  if (!blockedSenders.has(key) && blockedSenders.size < 50) {
    blockedSenders.add(key)
    log('warn', `IPC request blocked from untrusted sender: ${key}`)
  }
  return false
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
    const folder = result.canceled ? null : (result.filePaths[0] ?? null)
    // The save folder only changes here, through the native picker. setSettings ignores it.
    if (folder && isAbsolute(folder)) store.set('saveDir', folder)
    return pickFolderOutputSchema.parse(folder)
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
    // The schema has no saveDir, so a renderer value is dropped: the save folder only changes
    // through the folder picker. Shortcuts only change through shortcutsSet, which validates them.
    const settings = setSettingsInputSchema.parse(input)
    const current = readSettings()
    store.set({
      ...settings,
      audioDeviceId: settings.audioDeviceId ?? 'default',
      shortcuts: current.shortcuts
    })
    return setSettingsOutputSchema.parse({
      ...settings,
      saveDir: current.saveDir,
      shortcuts: current.shortcuts
    })
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
    // Stored entries are checked one by one, a damaged entry is dropped instead of breaking the list.
    const items = pruneMissing(sanitizeRecent(recentStore.get('items', [])), (filePath) =>
      existsSync(filePath)
    )
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

  ipcMain.handle(IPC_CHANNELS.recoveryList, async (event, input: unknown) => {
    validateSender(event)
    recoveryListInputSchema.parse(input)
    return recoveryListOutputSchema.parse(
      await listAbandonedParts(readSettings().saveDir, getActiveTempPath())
    )
  })

  const recoveryPath = (input: unknown): string => {
    if (activeSession) throw new Error('Cannot recover files while a recording is in progress')
    const { partPath } = recoveryPathInputSchema.parse(input)
    if (!isRecoverablePartPath(readSettings().saveDir, partPath)) {
      throw new Error('That file is not a recoverable recording in the save folder')
    }
    return partPath
  }

  ipcMain.handle(IPC_CHANNELS.recoveryRecover, async (event, input: unknown) => {
    validateSender(event)
    const filePath = await recoverPart(recoveryPath(input))
    return recoveryRecoverOutputSchema.parse({ filePath })
  })

  ipcMain.handle(IPC_CHANNELS.recoveryShow, (event, input: unknown) => {
    validateSender(event)
    shell.showItemInFolder(recoveryPath(input))
    return recoveryDiscardOutputSchema.parse(true)
  })

  ipcMain.handle(IPC_CHANNELS.recoveryDiscard, async (event, input: unknown) => {
    validateSender(event)
    await deletePart(recoveryPath(input))
    return recoveryDiscardOutputSchema.parse(true)
  })

  const SOURCE_GONE_MESSAGE =
    'The selected screen or window is no longer available. Refresh the list and select it again.'

  const findCaptureSource = async (sourceId: string): Promise<Electron.DesktopCapturerSource> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 1, height: 1 },
      fetchWindowIcons: false
    })
    const source = sources.find((candidate) => candidate.id === sourceId)
    if (!source) throw new Error(SOURCE_GONE_MESSAGE)
    return source
  }

  /**
   * Creates the session record and its single teardown. Every exit path (stop, failed startup,
   * owner window closed or crashed) goes through `session.end`, which runs once.
   */
  const createSession = (owner: WebContents): ActiveRecordingSession => {
    let fileTeardown: FileTeardown = 'none'
    const session: ActiveRecordingSession = {
      id: randomUUID(),
      ownerId: owner.id,
      phase: 'starting',
      tornDown: false,
      end: () => Promise.resolve()
    }
    const onOwnerLoss = (): void => {
      if (session.tornDown) return
      log('warn', `Recording window went away during phase '${session.phase}'`)
      void session.end(ownerLossTeardown(session.phase))
    }
    const run = once(
      async () => {
        owner.removeListener('destroyed', onOwnerLoss)
        owner.removeListener('render-process-gone', onOwnerLoss)
        session.stopMonitors?.()
        closeAnnotationOverlay()
        setSelectedSourceId('')
        if (!session.tempPath) return
        if (fileTeardown === 'discard') await discardActiveRecording(session.tempPath)
        else if (fileTeardown === 'keep') await closeActiveRecordingKeepingPart(session.tempPath)
      },
      (error) => log('error', 'Recording teardown failed', error)
    )
    session.end = async (mode: FileTeardown): Promise<void> => {
      if (!session.tornDown) {
        session.tornDown = true
        fileTeardown = mode
      }
      await run()
      if (activeSession === session) activeSession = undefined
    }
    owner.on('destroyed', onOwnerLoss)
    owner.on('render-process-gone', onOwnerLoss)
    return session
  }

  const sessionFor = (event: IpcMainInvokeEvent, sessionId: string): ActiveRecordingSession => {
    const session = activeSession
    if (
      !session ||
      session.tornDown ||
      session.id !== sessionId ||
      session.ownerId !== event.sender.id
    ) {
      throw new Error('Recording session is not valid')
    }
    return session
  }

  ipcMain.handle(IPC_CHANNELS.recordingSelectSource, async (event, input: unknown) => {
    validateSender(event)
    if (activeSession) throw new Error('A recording is already in progress')
    const { sourceId } = recordingSelectSourceInputSchema.parse(input)
    // Checked here so a closed window or unplugged screen gives a clear error instead of a
    // generic capture refusal from getDisplayMedia.
    await findCaptureSource(sourceId)
    if (activeSession) throw new Error('A recording is already in progress')
    setSelectedSourceId(sourceId)
    return recordingSelectSourceOutputSchema.parse(true)
  })

  ipcMain.handle(IPC_CHANNELS.recordingStart, async (event, input: unknown) => {
    validateSender(event)
    if (activeSession) throw new Error('A recording is already in progress')
    const recording = recordingStartInputSchema.parse(input)
    const owner = event.sender
    const win = BrowserWindow.fromWebContents(owner)
    const session = createSession(owner)
    activeSession = session
    const ensureActive = (): void => {
      if (isStartupCancelled(activeSession, session.id)) {
        throw new Error('Recording startup was cancelled')
      }
    }

    try {
      const source = await findCaptureSource(recording.sourceId)
      ensureActive()
      // Always the folder stored by the main process (chosen with the folder picker).
      const saveDir = readSettings().saveDir

      const filePath = await startRecordingFile(saveDir, new Date(), recording.mimeType)
      session.tempPath = getActiveTempPath()
      ensureActive()

      // Open the annotation windows first so the main window only hides when the panel is usable.
      // A failure here never blocks the recording, it is reported as a warning.
      let overlay: OverlayOpenResult
      try {
        overlay = await openAnnotationOverlay(
          source.display_id,
          source.id,
          owner,
          saveDir,
          sourceKindOf(source.id) !== 'window'
        )
      } catch (error) {
        log('error', 'Opening the annotation overlay failed', error)
        closeAnnotationOverlay()
        const reason = error instanceof Error ? error.message : String(error)
        overlay = { canvas: false, toolbar: false, error: reason.slice(0, 500) }
      }
      ensureActive()
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
      ensureActive()

      session.phase = 'recording'
      return recordingStartOutputSchema.parse({ filePath, sessionId: session.id, overlay })
    } catch (error) {
      // No data has been written yet, so the empty file is discarded.
      const ownsGlobals = !activeSession || activeSession === session
      await session.end('discard')
      // The teardown may have run (owner loss) before the file existed. Clean up what startup
      // created after that. The path check keeps this from touching any other recording.
      if (session.tempPath) await discardActiveRecording(session.tempPath)
      if (ownsGlobals) closeAnnotationOverlay()
      if (win && !win.isDestroyed() && win.isMinimized()) win.restore()
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.recordingChunk, async (event, input: unknown) => {
    validateSender(event)
    const chunk = recordingChunkInputSchema.parse(input)
    sessionFor(event, chunk.sessionId)
    return recordingChunkOutputSchema.parse(await appendRecordingChunk(chunk.data))
  })

  ipcMain.handle(IPC_CHANNELS.recordingStop, async (event, input: unknown) => {
    validateSender(event)
    const stop = recordingStopInputSchema.parse(input)
    const session = sessionFor(event, stop.sessionId)
    // Stopping owns the file from here, an owner loss must not close it a second time.
    session.phase = 'stopping'
    const win = BrowserWindow.fromWebContents(event.sender)
    try {
      const filePath = await stopRecordingFile(stop.mimeType, stop.discard === true)
      return recordingStopOutputSchema.parse({ ok: true, filePath })
    } catch (error) {
      // Returned instead of thrown so the kept path and the error code reach the renderer.
      const failure = toStopFailure(error)
      if (failure.code !== 'cancelled') log('error', 'Stopping the recording failed', error)
      return recordingStopOutputSchema.parse(failure)
    } finally {
      await session.end('none')
      if (win && !win.isDestroyed() && win.isMinimized()) {
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
