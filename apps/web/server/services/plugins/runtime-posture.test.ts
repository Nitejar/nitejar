import { describe, expect, it } from 'vitest'
import { getPluginRuntimePosture, resolvePluginTrustMode } from './runtime-posture'

describe('resolvePluginTrustMode', () => {
  it('defaults to self_host_guarded when unset or invalid', () => {
    expect(resolvePluginTrustMode(undefined)).toBe('self_host_guarded')
    expect(resolvePluginTrustMode('invalid-mode')).toBe('self_host_guarded')
  })

  it('accepts supported trust modes', () => {
    expect(resolvePluginTrustMode('self_host_open')).toBe('self_host_open')
    expect(resolvePluginTrustMode('self_host_guarded')).toBe('self_host_guarded')
    expect(resolvePluginTrustMode('saas_locked')).toBe('saas_locked')
  })
})

describe('getPluginRuntimePosture', () => {
  it('returns in_process execution and open-mode limitations', () => {
    const posture = getPluginRuntimePosture('self_host_open')
    expect(posture.executionMode).toBe('in_process')
    expect(posture.effectiveLimitations.join(' ')).toContain('not hard sandbox-enforced')
  })

  it('returns in_process execution and guarded-mode limitations', () => {
    const posture = getPluginRuntimePosture('self_host_guarded')
    expect(posture.executionMode).toBe('in_process')
    expect(posture.effectiveLimitations.join(' ')).toContain('host-managed API boundaries')
  })
})
