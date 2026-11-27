import { describe, expect, it } from 'vitest'
import {
  captureExclusionMode,
  describeCaptureMode,
  panelProtectionPlan,
  parseWindowsBuild
} from '../src/main/windows/platformCaps'

describe('parseWindowsBuild', () => {
  it('reads the build number', () => {
    expect(parseWindowsBuild('10.0.19045')).toBe(19045)
    expect(parseWindowsBuild('10.0.17763')).toBe(17763)
  })
  it('returns null for garbage', () => {
    expect(parseWindowsBuild('')).toBeNull()
    expect(parseWindowsBuild('abc')).toBeNull()
    expect(parseWindowsBuild('10.0')).toBeNull()
    expect(parseWindowsBuild('10.0.x')).toBeNull()
  })
})

describe('captureExclusionMode', () => {
  it.each(['10.0.17763', '10.0.18362', '10.0.19040'])('does not protect old build %s', (r) => {
    expect(captureExclusionMode('win32', r)).toBe('include-unprotected')
  })
  it.each(['10.0.19041', '10.0.19044', '10.0.22621'])('excludes on build %s', (r) => {
    expect(captureExclusionMode('win32', r)).toBe('exclude')
  })
  it('excludes on other platforms and unparsable releases', () => {
    expect(captureExclusionMode('linux', '6.1.0')).toBe('exclude')
    expect(captureExclusionMode('darwin', '23.0.0')).toBe('exclude')
    expect(captureExclusionMode('win32', 'garbage')).toBe('exclude')
  })
  it('describes the mode', () => {
    expect(describeCaptureMode('win32', '10.0.17763', 'include-unprotected')).toBe(
      'Windows build 17763, panel capture: include-unprotected'
    )
  })
})

describe('panelProtectionPlan', () => {
  it('leaves the panel unprotected and warns on build 19040', () => {
    const plan = panelProtectionPlan('win32', '10.0.19040')
    expect(plan.protect).toBe(false)
    expect(plan.logLevel).toBe('warn')
    expect(plan.message).toContain('Windows build 19040')
  })
  it('protects the panel on build 19041', () => {
    const plan = panelProtectionPlan('win32', '10.0.19041')
    expect(plan.protect).toBe(true)
    expect(plan.logLevel).toBe('info')
  })
  it('protects on other platforms', () => {
    expect(panelProtectionPlan('linux', '6.1.0').protect).toBe(true)
  })
})
