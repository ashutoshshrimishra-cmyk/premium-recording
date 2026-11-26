import { describe, expect, it } from 'vitest'
import { screenshotFileName } from '../src/main/screenshotName'

describe('screenshotFileName', () => {
  it('formats local time with zero padding', () => {
    expect(screenshotFileName(new Date(2025, 0, 3, 4, 5, 6, 7))).toBe(
      'Screenshot_2025-01-03_04-05-06-007.png'
    )
  })
})
