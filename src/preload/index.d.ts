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

interface RecorderApi {
  getSources(input: GetSourcesInput): Promise<GetSourcesOutput>
  getDisplays(): Promise<GetDisplaysOutput>
  pickFolder(): Promise<PickFolderOutput>
  getSettings(): Promise<Settings>
  setSettings(settings: Settings): Promise<Settings>
  recordingSelectSource(input: RecordingSelectSourceInput): Promise<boolean>
  recordingStart(input: RecordingStartInput): Promise<RecordingStartOutput>
  recordingChunk(input: RecordingChunkInput): Promise<RecordingChunkOutput>
  recordingStop(input: RecordingStopInput): Promise<RecordingStopOutput>
  onRecordingStopRequested(callback: () => void): () => void
  overlaySetInteractive(input: OverlaySetInteractiveInput): Promise<OverlaySetInteractiveOutput>
  overlayRequestStop(): Promise<OverlayRequestStopOutput>
  overlaySendCommand(command: OverlayCommand): Promise<boolean>
  onOverlayCommand(callback: (command: OverlayCommand) => void): () => void
  overlayReportHistory(state: OverlayHistoryState): Promise<boolean>
  onOverlayHistoryChanged(callback: (state: OverlayHistoryState) => void): () => void
  overlaySaveScreenshot(): Promise<OverlaySaveScreenshotOutput>
  panelSendMicCommand(command: MicCommand): Promise<boolean>
  onRecordingMicCommand(callback: (command: MicCommand) => void): () => void
  recordingPublishMicState(state: MicState): Promise<boolean>
  onPanelMicState(callback: (state: MicState) => void): () => void
  panelGetLayout(): Promise<PanelLayout>
  panelSetLayout(input: PanelSetLayoutInput): Promise<PanelLayout>
  diagnosticsLog(line: string): Promise<boolean>
  diagnosticsGetInfo(): Promise<DiagnosticsInfo>
  diagnosticsShowLog(): Promise<boolean>
  diagnosticsProbeFile(filePath: string): Promise<DiagnosticsProbeFileOutput>
  shortcutsGet(): Promise<ShortcutsResult>
  shortcutsSet(shortcuts: ShortcutsConfig): Promise<ShortcutsResult>
  shortcutsSuspend(suspended: boolean): Promise<boolean>
  onShortcutAction(callback: (action: ShortcutActionEvent) => void): () => void
  recentList(): Promise<RecentRecording[]>
  recentAdd(filePath: string, durationMs: number): Promise<RecentRecording[]>
  recentOpen(filePath: string): Promise<boolean>
  recentShow(filePath: string): Promise<boolean>
  onOverlayCursor(callback: (cursor: OverlayCursor) => void): () => void
  onOverlayClick(callback: (click: OverlayClick) => void): () => void
  onOverlayInteractiveChanged(callback: (interactive: boolean) => void): () => void
}

declare global {
  interface Window {
    api: RecorderApi
  }
}
