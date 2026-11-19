import type {
  GetDisplaysOutput,
  GetSourcesOutput,
  PickFolderOutput,
  Settings,
  RecordingSelectSourceInput,
  RecordingStartInput,
  RecordingStartOutput,
  RecordingChunkOutput,
  RecordingStopInput,
  RecordingStopOutput
} from '../shared/ipc-schemas'

interface RecorderApi {
  getSources(): Promise<GetSourcesOutput>
  getDisplays(): Promise<GetDisplaysOutput>
  pickFolder(): Promise<PickFolderOutput>
  getSettings(): Promise<Settings>
  setSettings(settings: Settings): Promise<Settings>
  recordingSelectSource(input: RecordingSelectSourceInput): Promise<boolean>
  recordingStart(input: RecordingStartInput): Promise<RecordingStartOutput>
  recordingChunk(chunk: ArrayBuffer): Promise<RecordingChunkOutput>
  recordingStop(input: RecordingStopInput): Promise<RecordingStopOutput>
}

declare global {
  interface Window {
    api: RecorderApi
  }
}
