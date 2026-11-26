export const IPC_CHANNELS = {
  getSources: 'get-sources',
  getDisplays: 'get-displays',
  pickFolder: 'pick-folder',
  getSettings: 'get-settings',
  setSettings: 'set-settings',
  recordingSelectSource: 'recording-select-source',
  recordingStart: 'recording-start',
  recordingChunk: 'recording-chunk',
  recordingStop: 'recording-stop',
  recordingStopRequested: 'recording-stop-requested',
  overlaySetInteractive: 'overlay-set-interactive',
  overlayInteractiveChanged: 'overlay-interactive-changed',
  overlayRequestStop: 'overlay-request-stop'
} as const
