import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type {
  GetDisplaysOutput,
  GetSourcesOutput,
  PickFolderOutput,
  Settings
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
    ipcRenderer.invoke(IPC_CHANNELS.setSettings, settings)
}

contextBridge.exposeInMainWorld('api', api)
