import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type {
  GetDisplaysOutput,
  GetSourcesOutput,
  PickFolderOutput,
  Settings,
  RecordingStartInput,
  RecordingStartOutput,
  RecordingChunkOutput,
  RecordingStopInput,
  RecordingStopOutput
} from '../shared/ipc-schemas'

const api = {
  getSources: (): Promise<GetSourcesOutput> =>
    ipcRenderer.invoke(IPC_CHANNELS.getSources, undefined),
  getDisplays: (): Promise<GetDisplaysOutput> =>
    ipcRenderer.invoke(IPC_CHANNELS.getDisplays, undefined),
  pickFolder: (): Promise<PickFolderOutput> =>
    ipcRenderer.invoke(IPC_CHANNELS.pickFolder, undefined),
  getSettings: (): Promise<Settings> =>
    ipcRenderer.invoke(IPC_CHANNELS.getSettings, undefined),
  setSettings: (settings: Settings): Promise<Settings> =>
    ipcRenderer.invoke(IPC_CHANNELS.setSettings, settings),
  recordingStart: (input: RecordingStartInput): Promise<RecordingStartOutput> =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingStart, input),
  recordingChunk: (chunk: ArrayBuffer): Promise<RecordingChunkOutput> =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingChunk, chunk),
  recordingStop: (input: RecordingStopInput): Promise<RecordingStopOutput> =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingStop, input)
}

contextBridge.exposeInMainWorld('api', api)
