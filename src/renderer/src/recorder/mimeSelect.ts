/**
 * MediaRecorder MIME candidates, best first. When audio is requested every candidate names an audio codec
 * explicitly, because an unspecified codec lets some Windows installs silently drop the audio track.
 */
export function buildMimeCandidates(hasAudio: boolean): string[] {
  if (hasAudio) {
    return [
      'video/mp4;codecs=avc1.640033,mp4a.40.2',
      'video/mp4;codecs=avc1.64002A,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/mp4;codecs=avc1,opus',
      'video/webm;codecs=h264,opus'
    ]
  }
  return ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
}
