import { displayAccelerator } from '../../../shared/shortcuts'

export const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

export function showShortcut(accelerator: string): string {
  return displayAccelerator(accelerator, isMac)
}
