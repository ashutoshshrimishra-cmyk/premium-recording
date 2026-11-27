import { create } from 'zustand'
import type { Settings } from '../../../shared/ipc-schemas'
import type { RegionFraction } from '../recorder/cropMath'

export type CaptureMode = 'screen' | 'window' | 'region'
export type Resolution = Settings['resolution']

interface RecorderState {
  captureMode: CaptureMode
  selectedSourceId: string
  region: RegionFraction | undefined
  resolution: Resolution
  fps: number
  audioDeviceId: string
  noiseSuppression: boolean
  saveDir: string
  loaded: boolean
  setCaptureMode: (captureMode: CaptureMode) => void
  setSelectedSourceId: (selectedSourceId: string) => void
  setRegion: (region: RegionFraction | undefined) => void
  setResolution: (resolution: Resolution) => void
  setFps: (fps: number) => void
  setAudioDeviceId: (audioDeviceId: string) => void
  setNoiseSuppression: (noiseSuppression: boolean) => void
  setSaveDir: (saveDir: string) => void
  loadSettings: () => Promise<void>
}

let persistTimer: ReturnType<typeof setTimeout> | undefined

function debounceSettings(state: RecorderState): void {
  if (!state.loaded) return

  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    const settings: Settings = {
      saveDir: state.saveDir,
      fps: state.fps,
      resolution: state.resolution,
      noiseSuppression: state.noiseSuppression,
      audioDeviceId: state.audioDeviceId
    }
    void window.api.setSettings(settings)
  }, 300)
}

export const useRecorderStore = create<RecorderState>((set, get) => ({
  captureMode: 'screen',
  selectedSourceId: '',
  region: undefined,
  resolution: '1080p',
  fps: 30,
  audioDeviceId: 'default',
  noiseSuppression: true,
  saveDir: '',
  loaded: false,
  setCaptureMode: (captureMode) =>
    set((state) =>
      state.captureMode === captureMode
        ? state
        : { captureMode, selectedSourceId: '', region: undefined }
    ),
  setSelectedSourceId: (selectedSourceId) =>
    set((state) =>
      state.selectedSourceId === selectedSourceId ? state : { selectedSourceId, region: undefined }
    ),
  setRegion: (region) => set({ region }),
  setResolution: (resolution) => {
    set({ resolution })
    debounceSettings(get())
  },
  setFps: (fps) => {
    set({ fps })
    debounceSettings(get())
  },
  setNoiseSuppression: (noiseSuppression) => {
    set({ noiseSuppression })
    debounceSettings(get())
  },
  setSaveDir: (saveDir) => {
    set({ saveDir })
    debounceSettings(get())
  },
  setAudioDeviceId: (audioDeviceId) => {
    set({ audioDeviceId })
    debounceSettings(get())
  },
  loadSettings: async () => {
    const settings = await window.api.getSettings()
    set({ ...settings, audioDeviceId: settings.audioDeviceId ?? 'default', loaded: true })
  }
}))
