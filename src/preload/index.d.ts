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
  OverlayRequestStopOutput
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
  onOverlayInteractiveChanged(callback: (interactive: boolean) => void): () => void
}

declare global {
  interface Window {
    api: RecorderApi
  }
}
