import type {
  GetDisplaysOutput,
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
  OverlayHistoryState,
  OverlaySaveScreenshotOutput,
  DiagnosticsInfo,
  DiagnosticsProbeFileOutput
} from '../shared/ipc-schemas'

interface RecorderApi {
  getSources(): Promise<GetSourcesOutput>
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
  diagnosticsLog(line: string): Promise<boolean>
  diagnosticsGetInfo(): Promise<DiagnosticsInfo>
  diagnosticsShowLog(): Promise<boolean>
  diagnosticsProbeFile(filePath: string): Promise<DiagnosticsProbeFileOutput>
  onOverlayInteractiveChanged(callback: (interactive: boolean) => void): () => void
}

declare global {
  interface Window {
    api: RecorderApi
  }
}
