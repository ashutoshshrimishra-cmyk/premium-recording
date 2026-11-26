import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
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
  onOverlayInteractiveChanged: (callback: (interactive: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, interactive: boolean): void =>
      callback(interactive)
    ipcRenderer.on(IPC_CHANNELS.overlayInteractiveChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.overlayInteractiveChanged, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
