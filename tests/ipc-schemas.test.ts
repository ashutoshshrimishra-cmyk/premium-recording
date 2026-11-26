import { describe, expect, it } from 'vitest'
import {
  getSourcesInputSchema,
  getSourcesOutputSchema,
  getDisplaysInputSchema,
  getDisplaysOutputSchema,
  pickFolderInputSchema,
  pickFolderOutputSchema,
  getSettingsInputSchema,
  getSettingsOutputSchema,
  setSettingsInputSchema,
  setSettingsOutputSchema,
  recordingStartOutputSchema,
  micCommandSchema,
  micStateSchema,
  panelSetLayoutInputSchema,
  panelLayoutSchema,
  overlayCommandSchema,
  overlayCursorSchema
} from '../src/shared/ipc-schemas'

describe('IPC schemas', () => {
  it('accepts valid get-sources input and output', () => {
    expect(getSourcesInputSchema.safeParse(undefined).success).toBe(true)
    expect(
      getSourcesOutputSchema.safeParse([
        {
          id: 'screen:0:0',
          name: 'Entire Screen',
          displayId: '123',
          thumbnail: 'data:image/png;base64,AAAA'
        }
      ]).success
    ).toBe(true)
  })

  it('rejects invalid get-sources input and output', () => {
    expect(getSourcesInputSchema.safeParse('invalid').success).toBe(false)
    expect(
      getSourcesOutputSchema.safeParse([
        { id: '', name: 'Screen', displayId: '123', thumbnail: 'not-a-data-url' }
      ]).success
    ).toBe(false)
  })

  it('accepts valid get-displays input and output', () => {
    expect(getDisplaysInputSchema.safeParse(undefined).success).toBe(true)
    expect(
      getDisplaysOutputSchema.safeParse([
        {
          id: '123',
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          scaleFactor: 1
        }
      ]).success
    ).toBe(true)
  })

  it('rejects invalid get-displays input and output', () => {
    expect(getDisplaysInputSchema.safeParse('invalid').success).toBe(false)
    expect(
      getDisplaysOutputSchema.safeParse([
        {
          id: '123',
          bounds: { x: 0, y: 0, width: -1, height: 1080 },
          scaleFactor: 0
        }
      ]).success
    ).toBe(false)
  })

  it('accepts valid pick-folder input and output', () => {
    expect(pickFolderInputSchema.safeParse(undefined).success).toBe(true)
    expect(pickFolderOutputSchema.safeParse('/home/user/Videos').success).toBe(true)
    expect(pickFolderOutputSchema.safeParse(null).success).toBe(true)
  })

  it('rejects invalid pick-folder input and output', () => {
    expect(pickFolderInputSchema.safeParse('invalid').success).toBe(false)
    expect(pickFolderOutputSchema.safeParse(42).success).toBe(false)
  })

  it('accepts valid get-settings input and output', () => {
    expect(getSettingsInputSchema.safeParse(undefined).success).toBe(true)
    expect(
      getSettingsOutputSchema.safeParse({
        saveDir: 'Videos/MyRecorder',
        fps: 30,
        resolution: '1080p',
        noiseSuppression: true
      }).success
    ).toBe(true)
  })

  it('rejects invalid get-settings input and output', () => {
    expect(getSettingsInputSchema.safeParse('invalid').success).toBe(false)
    expect(
      getSettingsOutputSchema.safeParse({
        saveDir: '',
        fps: 0,
        resolution: '720p',
        noiseSuppression: 'yes'
      }).success
    ).toBe(false)
  })

  it('accepts valid set-settings input and output', () => {
    const settings = {
      saveDir: '/mnt/recordings',
      fps: 60,
      resolution: '1440p' as const,
      noiseSuppression: false
    }
    expect(setSettingsInputSchema.safeParse(settings).success).toBe(true)
    expect(setSettingsOutputSchema.safeParse(settings).success).toBe(true)
  })

  it('rejects invalid set-settings input and output', () => {
    expect(setSettingsInputSchema.safeParse({ fps: -1 }).success).toBe(false)
    expect(setSettingsOutputSchema.safeParse({ fps: '30' }).success).toBe(false)
  })

  it('keeps old settings valid and accepts an optional microphone id', () => {
    const base = { saveDir: '/tmp', fps: 30, resolution: '1080p', noiseSuppression: true }
    expect(setSettingsInputSchema.safeParse(base).success).toBe(true)
    expect(setSettingsInputSchema.safeParse({ ...base, audioDeviceId: 'default' }).success).toBe(
      true
    )
    expect(setSettingsInputSchema.safeParse({ ...base, audioDeviceId: '' }).success).toBe(false)
  })

  it('requires overlay status in the recording start result', () => {
    const base = { filePath: 'C:\\v\\a.mp4', sessionId: '0123456789abcdef0123' }
    expect(
      recordingStartOutputSchema.safeParse({
        ...base,
        overlay: { canvas: true, toolbar: false, error: 'No display' }
      }).success
    ).toBe(true)
    expect(recordingStartOutputSchema.safeParse(base).success).toBe(false)
  })

  it('validates microphone commands from the panel', () => {
    expect(micCommandSchema.safeParse({ type: 'mute', muted: true }).success).toBe(true)
    expect(micCommandSchema.safeParse({ type: 'denoise', active: false }).success).toBe(true)
    expect(micCommandSchema.safeParse({ type: 'mute' }).success).toBe(false)
    expect(micCommandSchema.safeParse({ type: 'volume', value: 3 }).success).toBe(false)
  })

  it('validates microphone state with a bounded level', () => {
    const state = { muted: false, level: 0.4, denoised: true, bypassed: false, available: true }
    expect(micStateSchema.safeParse(state).success).toBe(true)
    expect(micStateSchema.safeParse({ ...state, level: 1.5 }).success).toBe(false)
    expect(micStateSchema.safeParse({ ...state, muted: 'no' }).success).toBe(false)
  })

  it('validates panel layout requests', () => {
    expect(panelSetLayoutInputSchema.safeParse({ dock: 'left' }).success).toBe(true)
    expect(panelSetLayoutInputSchema.safeParse({ expanded: true }).success).toBe(true)
    expect(panelSetLayoutInputSchema.safeParse({ dock: 'center' }).success).toBe(false)
    expect(panelLayoutSchema.safeParse({ dock: 'right', expanded: false }).success).toBe(true)
  })

  it('validates cursor effect commands and cursor samples', () => {
    const settings = {
      highlight: true,
      ripple: false,
      drawPointer: true,
      highlightColor: 'rgba(255, 214, 10, 0.35)',
      radius: 28
    }
    expect(overlayCommandSchema.safeParse({ type: 'cursorEffect', settings }).success).toBe(true)
    expect(
      overlayCommandSchema.safeParse({
        type: 'cursorEffect',
        settings: { ...settings, radius: 500 }
      }).success
    ).toBe(false)
    expect(overlayCursorSchema.safeParse({ x: 1, y: 2, inside: true }).success).toBe(true)
    expect(overlayCursorSchema.safeParse({ x: 1, y: 2 }).success).toBe(false)
  })
})
