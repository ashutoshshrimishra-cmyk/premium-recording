import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHORTCUTS,
  acceleratorFromKeyEvent,
  displayAccelerator,
  findDuplicates,
  validateAccelerator
} from '../src/shared/shortcuts'

describe('validateAccelerator', () => {
  it('accepts and normalises accelerators', () => {
    expect(validateAccelerator('ctrl+shift+r')).toEqual({
      valid: true,
      accelerator: 'Control+Shift+R'
    })
    expect(validateAccelerator('Shift+CmdOrCtrl+F5').accelerator).toBe('CommandOrControl+Shift+F5')
    expect(validateAccelerator('Alt+Space').accelerator).toBe('Alt+Space')
  })

  it('accepts every default', () => {
    for (const value of Object.values(DEFAULT_SHORTCUTS)) {
      expect(validateAccelerator(value).valid).toBe(true)
    }
  })

  it('rejects empty, unknown and malformed values', () => {
    expect(validateAccelerator('').valid).toBe(false)
    expect(validateAccelerator('Ctrl+').valid).toBe(false)
    expect(validateAccelerator('Foo+R').valid).toBe(false)
    expect(validateAccelerator('Ctrl+Shift').valid).toBe(false)
    expect(validateAccelerator('Ctrl+Alt+Shift+Q+W').valid).toBe(false)
  })

  it('rejects a plain key or Shift only, but allows function keys', () => {
    expect(validateAccelerator('R').valid).toBe(false)
    expect(validateAccelerator('Shift+R').valid).toBe(false)
    expect(validateAccelerator('F9').valid).toBe(true)
  })
})

describe('findDuplicates', () => {
  it('finds actions that share an accelerator regardless of spelling', () => {
    const duplicates = findDuplicates({
      ...DEFAULT_SHORTCUTS,
      pauseResume: 'ctrl+shift+r',
      startStop: 'Control+Shift+R'
    })
    expect(duplicates).toEqual([
      { accelerator: 'Control+Shift+R', actions: ['startStop', 'pauseResume'] }
    ])
  })

  it('returns nothing for the defaults', () => {
    expect(findDuplicates(DEFAULT_SHORTCUTS)).toEqual([])
  })
})

describe('acceleratorFromKeyEvent', () => {
  const base = {
    key: 'r',
    code: 'KeyR',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: true
  }

  it('builds an accelerator from letters, using the physical key', () => {
    expect(acceleratorFromKeyEvent(base, false)).toBe('CommandOrControl+Shift+R')
    expect(acceleratorFromKeyEvent({ ...base, key: 'R' }, false)).toBe('CommandOrControl+Shift+R')
  })

  it('maps Cmd to CommandOrControl on macOS', () => {
    expect(acceleratorFromKeyEvent({ ...base, ctrlKey: false, metaKey: true }, true)).toBe(
      'CommandOrControl+Shift+R'
    )
  })

  it('waits while only a modifier is pressed', () => {
    expect(
      acceleratorFromKeyEvent({ ...base, key: 'Control', code: 'ControlLeft' }, false)
    ).toBeUndefined()
  })

  it('handles function and arrow keys', () => {
    expect(
      acceleratorFromKeyEvent({ ...base, key: 'F8', code: 'F8', shiftKey: false }, false)
    ).toBe('CommandOrControl+F8')
    expect(
      acceleratorFromKeyEvent({ ...base, key: 'ArrowUp', code: 'ArrowUp', shiftKey: false }, false)
    ).toBe('CommandOrControl+Up')
  })
})

describe('displayAccelerator', () => {
  it('shows platform names', () => {
    expect(displayAccelerator('CommandOrControl+Shift+R', false)).toBe('Ctrl+Shift+R')
    expect(displayAccelerator('CommandOrControl+Shift+R', true)).toBe('Cmd+Shift+R')
  })
})
