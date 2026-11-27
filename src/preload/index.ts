import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type {
  GetDisplaysOutput,
  GetSourcesInput,
  GetSourcesOutput,
  PickFolderOutput,
  Settings,
  RecordingSelectSourceInput,
  RecordingStartInput,
  RecordingStartOutput,
  RecordingChunkInput,
  RecordingChunkOutput,
  RecordingStopInput,
  RecordingStopOutput,
  OverlaySetInteractiveInput,
  OverlaySetInteractiveOutput,
  OverlayRequestStopOutput,
  OverlayCommand,
  OverlayCursor,
  OverlayClick,
  OverlayHistoryState,
  OverlaySaveScreenshotOutput,
  MicCommand,
  MicState,
  PanelLayout,
  PanelSetLayoutInput,
  DiagnosticsInfo,
  DiagnosticsProbeFileOutput,
  RecentRecording,
  ShortcutActionEvent,
  ShortcutsConfig,
  ShortcutsResult
} from '../shared/ipc-schemas'

const api = {
  getSources: (input: GetSourcesInput): Promise<GetSourcesOutput> =>
    ipcRenderer.invoke(IPC_CHANNELS.getSources, input),
  getDisplays: (): Promise<GetDisplaysOutput> =>
    ipcRenderer.invoke(IPC_CHANNELS.getDisplays, undefined),
  pickFolder: (): Promise<PickFolderOutput> =>
    ipcRenderer.invoke(IPC_CHANNELS.pickFolder, undefined),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC_CHANNELS.getSettings, undefined),
  setSettings: (settings: Settings): Promise<Settings> =>
    ipcRenderer.invoke(IPC_CHANNELS.setSettings, settings),
  recordingSelectSource: (input: RecordingSelectSourceInput): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingSelectSource, input),
  recordingStart: (input: RecordingStartInput): Promise<RecordingStartOutput> =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingStart, input),
  recordingChunk: (input: RecordingChunkInput): Promise<RecordingChunkOutput> =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingChunk, input),
  recordingStop: (input: RecordingStopInput): Promise<RecordingStopOutput> =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingStop, input),
  onRecordingStopRequested: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.recordingStopRequested, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.recordingStopRequested, listener)
  },
  overlaySetInteractive: (
    input: OverlaySetInteractiveInput
  ): Promise<OverlaySetInteractiveOutput> =>
    ipcRenderer.invoke(IPC_CHANNELS.overlaySetInteractive, input),
  overlayRequestStop: (): Promise<OverlayRequestStopOutput> =>
    ipcRenderer.invoke(IPC_CHANNELS.overlayRequestStop, undefined),
  overlaySendCommand: (command: OverlayCommand): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.overlayCommand, command),
  onOverlayCommand: (callback: (command: OverlayCommand) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: OverlayCommand): void =>
      callback(command)
    ipcRenderer.on(IPC_CHANNELS.overlayCommandReceived, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.overlayCommandReceived, listener)
  },
  onOverlayCursor: (callback: (cursor: OverlayCursor) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, cursor: OverlayCursor): void =>
      callback(cursor)
    ipcRenderer.on(IPC_CHANNELS.overlayCursor, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.overlayCursor, listener)
  },
  onOverlayClick: (callback: (click: OverlayClick) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, click: OverlayClick): void =>
      callback(click)
    ipcRenderer.on(IPC_CHANNELS.overlayClick, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.overlayClick, listener)
  },
  overlayReportHistory: (state: OverlayHistoryState): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.overlayReportHistory, state),
  onOverlayHistoryChanged: (callback: (state: OverlayHistoryState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: OverlayHistoryState): void =>
      callback(state)
    ipcRenderer.on(IPC_CHANNELS.overlayHistoryChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.overlayHistoryChanged, listener)
  },
  overlaySaveScreenshot: (): Promise<OverlaySaveScreenshotOutput> =>
    ipcRenderer.invoke(IPC_CHANNELS.overlaySaveScreenshot, undefined),
  panelSendMicCommand: (command: MicCommand): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.panelMicCommand, command),
  onRecordingMicCommand: (callback: (command: MicCommand) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: MicCommand): void =>
      callback(command)
    ipcRenderer.on(IPC_CHANNELS.recordingMicCommand, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.recordingMicCommand, listener)
  },
  recordingPublishMicState: (state: MicState): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingMicState, state),
  onPanelMicState: (callback: (state: MicState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: MicState): void => callback(state)
    ipcRenderer.on(IPC_CHANNELS.panelMicState, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.panelMicState, listener)
  },
  panelGetLayout: (): Promise<PanelLayout> =>
    ipcRenderer.invoke(IPC_CHANNELS.panelGetLayout, undefined),
  panelSetLayout: (input: PanelSetLayoutInput): Promise<PanelLayout> =>
    ipcRenderer.invoke(IPC_CHANNELS.panelSetLayout, input),
  diagnosticsLog: (line: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.diagnosticsLog, { line }),
  diagnosticsGetInfo: (): Promise<DiagnosticsInfo> =>
    ipcRenderer.invoke(IPC_CHANNELS.diagnosticsGetInfo, undefined),
  diagnosticsShowLog: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.diagnosticsShowLog, undefined),
  diagnosticsProbeFile: (filePath: string): Promise<DiagnosticsProbeFileOutput> =>
    ipcRenderer.invoke(IPC_CHANNELS.diagnosticsProbeFile, { filePath }),
  shortcutsGet: (): Promise<ShortcutsResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.shortcutsGet, undefined),
  shortcutsSet: (shortcuts: ShortcutsConfig): Promise<ShortcutsResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.shortcutsSet, shortcuts),
  shortcutsSuspend: (suspended: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.shortcutsSuspend, { suspended }),
  onShortcutAction: (callback: (action: ShortcutActionEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: ShortcutActionEvent): void =>
      callback(action)
    ipcRenderer.on(IPC_CHANNELS.shortcutAction, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.shortcutAction, listener)
  },
  recentList: (): Promise<RecentRecording[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.recentList, undefined),
  recentAdd: (filePath: string, durationMs: number): Promise<RecentRecording[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.recentAdd, { filePath, durationMs }),
  recentOpen: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.recentOpen, { filePath }),
  recentShow: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.recentShow, { filePath }),
  onOverlayInteractiveChanged: (callback: (interactive: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, interactive: boolean): void =>
      callback(interactive)
    ipcRenderer.on(IPC_CHANNELS.overlayInteractiveChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.overlayInteractiveChanged, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
