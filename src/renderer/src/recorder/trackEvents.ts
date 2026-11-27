/** Messages for capture tracks that end during a recording. */

export const MIC_DISCONNECTED_MESSAGE =
  'The microphone was disconnected. The recording continues without audio. Stop and start a new recording to record audio again.'

/** Why the video ended, named by what was captured instead of a generic "stream ended". */
export function captureEndedMessage(kind: 'screen' | 'window' | 'unknown'): string {
  if (kind === 'window') {
    return 'The captured window was closed, so the recording was stopped and saved.'
  }
  if (kind === 'screen') {
    return 'The captured screen was disconnected or turned off, so the recording was stopped and saved.'
  }
  return 'Screen capture ended unexpectedly, so the recording was stopped and saved.'
}
