export interface SenderTarget {
  id: number
  isDestroyed: () => boolean
}

/** True when `senderId` belongs to a live window or web contents. Used to gate IPC channels by window. */
export function isSenderOf(target: SenderTarget | undefined, senderId: number): boolean {
  return Boolean(target && !target.isDestroyed() && target.id === senderId)
}
