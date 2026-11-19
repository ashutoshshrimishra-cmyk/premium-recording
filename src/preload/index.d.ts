import type { GetDisplaysOutput, GetSourcesOutput, PickFolderOutput, Settings } from '../shared/ipc-schemas'

interface RecorderApi {
  getSources(): Promise<GetSourcesOutput>
  getDisplays(): Promise<GetDisplaysOutput>
  pickFolder(): Promise<PickFolderOutput>
  getSettings(): Promise<Settings>
  setSettings(settings: Settings): Promise<Settings>
}

declare global {
  interface Window {
    api: RecorderApi
  }
}
