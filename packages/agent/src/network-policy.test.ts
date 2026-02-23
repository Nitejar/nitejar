import { describe, expect, it } from 'vitest'
import { mergeAgentConfig, parseAgentConfig } from './config'
import {
  DEFAULT_NETWORK_POLICY,
  NETWORK_POLICY_PRESETS,
  getPresetById,
  isValidDomainPattern,
  validateNetworkPolicy,
} from './network-policy'

describe('network-policy presets', () => {
  it('includes required presets', () => {
    const ids = NETWORK_POLICY_PRESETS.map((preset) => preset.id)
    expect(ids).toContain('unrestricted')
    expect(ids).toContain('github-only')
    expect(ids).toContain('development')
    expect(ids).toContain('lockdown')
  })

  it('uses development preset as default', () => {
    expect(DEFAULT_NETWORK_POLICY.presetId).toBe('development')
  })

  it('returns a cloned preset policy', () => {
    const preset = getPresetById('development')
    expect(preset).toBeTruthy()
    if (!preset) {
      return
    }

    preset.policy.rules.push({ domain: 'example.com', action: 'allow' })
    const second = getPresetById('development')
    expect(second?.policy.rules.some((rule) => rule.domain === 'example.com')).toBe(false)
  })
})

describe('network-policy validation', () => {
  it('accepts valid domain patterns', () => {
    expect(isValidDomainPattern('github.com')).toBe(true)
    expect(isValidDomainPattern('api.github.com')).toBe(true)
    expect(isValidDomainPattern('*.npmjs.org')).toBe(true)
    expect(isValidDomainPattern('*')).toBe(true)
  })

  it('rejects invalid domain patterns', () => {
    expect(isValidDomainPattern('')).toBe(false)
    expect(isValidDomainPattern('**')).toBe(false)
    expect(isValidDomainPattern('http://github.com')).toBe(false)
    expect(isValidDomainPattern('*.*.com')).toBe(false)
  })

  it('validates a preset policy', () => {
    const preset = getPresetById('github-only')
    expect(preset).toBeTruthy()
    if (!preset) {
      return
    }

    const result = validateNetworkPolicy(preset.policy)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects missing catch-all rule', () => {
    const result = validateNetworkPolicy({
      mode: 'allow-list',
      rules: [{ domain: 'github.com', action: 'allow' }],
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Policy should include a catch-all (*) rule as the last entry')
  })
})

describe('network-policy config parsing', () => {
  it('parses config with network policy', () => {
    const config = parseAgentConfig(
      JSON.stringify({
        model: 'arcee-ai/trinity-large-preview:free',
        networkPolicy: {
          mode: 'allow-list',
          rules: [
            { domain: 'github.com', action: 'allow' },
            { domain: '*', action: 'deny' },
          ],
          presetId: 'github-only',
        },
      })
    )

    expect(config.networkPolicy).toBeTruthy()
    expect(config.networkPolicy?.mode).toBe('allow-list')
    expect(config.networkPolicy?.rules).toHaveLength(2)
  })

  it('keeps working when network policy is absent', () => {
    const config = parseAgentConfig(JSON.stringify({ model: 'test-model' }))
    expect(config.model).toBe('test-model')
    expect(config.networkPolicy).toBeUndefined()
  })

  it('merges network policy updates', () => {
    const merged = mergeAgentConfig(
      { model: 'test-model' },
      {
        networkPolicy: {
          mode: 'deny-list',
          rules: [{ domain: '*', action: 'deny' }],
          presetId: 'lockdown',
        },
      }
    )

    expect(merged.networkPolicy?.presetId).toBe('lockdown')
  })
})
