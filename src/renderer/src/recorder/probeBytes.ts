/** Only the container header is needed to detect an audio track. */
export const PROBE_BYTE_LIMIT = 256 * 1024

/** Returns the first `limit` bytes of the parts as a Blob without copying the rest into memory. */
export function probeSlice(parts: Blob[], limit: number = PROBE_BYTE_LIMIT): Blob {
  return new Blob(parts).slice(0, limit)
}
