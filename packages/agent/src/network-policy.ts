import type { NetworkPolicy, NetworkPolicyRule, PolicyPreset } from './types'

export const NETWORK_POLICY_PRESETS: PolicyPreset[] = [
  {
    id: 'unrestricted',
    name: 'Unrestricted',
    description: 'Full network access',
    policy: {
      mode: 'unrestricted',
      rules: [{ domain: '*', action: 'allow' }],
      presetId: 'unrestricted',
    },
  },
  {
    id: 'github-only',
    name: 'GitHub Only',
    description: 'GitHub API and git operations only',
    policy: {
      mode: 'allow-list',
      rules: [
        { domain: 'github.com', action: 'allow' },
        { domain: '*.github.com', action: 'allow' },
        { domain: 'api.github.com', action: 'allow' },
        { domain: 'raw.githubusercontent.com', action: 'allow' },
        { domain: '*.githubusercontent.com', action: 'allow' },
        { domain: '*', action: 'deny' },
      ],
      presetId: 'github-only',
    },
  },
  {
    id: 'development',
    name: 'Development',
    description: 'GitHub + npm + PyPI + common dev tooling',
    policy: {
      mode: 'allow-list',
      rules: [
        { domain: 'github.com', action: 'allow' },
        { domain: '*.github.com', action: 'allow' },
        { domain: 'api.github.com', action: 'allow' },
        { domain: '*.githubusercontent.com', action: 'allow' },
        { domain: 'registry.npmjs.org', action: 'allow' },
        { domain: '*.npmjs.org', action: 'allow' },
        { domain: 'pypi.org', action: 'allow' },
        { domain: '*.pypi.org', action: 'allow' },
        { domain: 'files.pythonhosted.org', action: 'allow' },
        { domain: 'crates.io', action: 'allow' },
        { domain: '*.crates.io', action: 'allow' },
        { domain: '*', action: 'deny' },
      ],
      presetId: 'development',
    },
  },
  {
    id: 'lockdown',
    name: 'Lockdown',
    description: 'Deny all external network access',
    policy: {
      mode: 'deny-list',
      rules: [{ domain: '*', action: 'deny' }],
      presetId: 'lockdown',
    },
  },
]

function clonePolicy(policy: NetworkPolicy): NetworkPolicy {
  return {
    ...policy,
    rules: policy.rules.map((rule) => ({ ...rule })),
  }
}

export const DEFAULT_NETWORK_POLICY: NetworkPolicy = clonePolicy(
  NETWORK_POLICY_PRESETS.find((preset) => preset.id === 'development')!.policy
)

export function getPresetById(id: string): PolicyPreset | undefined {
  const preset = NETWORK_POLICY_PRESETS.find((entry) => entry.id === id)
  if (!preset) {
    return undefined
  }

  return {
    ...preset,
    policy: clonePolicy(preset.policy),
  }
}

export function getPolicyStatus(policy?: NetworkPolicy): {
  label: string
  type: 'unrestricted' | 'preset' | 'custom' | 'none'
} {
  if (!policy) {
    return { label: 'None', type: 'none' }
  }

  if (policy.presetId && !policy.customized) {
    const preset = getPresetById(policy.presetId)
    return {
      label: preset?.name ?? policy.presetId,
      type: 'preset',
    }
  }

  if (policy.mode === 'unrestricted') {
    return { label: 'Unrestricted', type: 'unrestricted' }
  }

  return { label: 'Custom', type: 'custom' }
}

export function toSpriteNetworkPolicy(policy: NetworkPolicy): {
  rules: Array<{ domain: string; action: 'allow' | 'deny' }>
} {
  const rules = policy.rules
    .filter((rule) => typeof rule.domain === 'string' && typeof rule.action === 'string')
    .map((rule) => ({
      domain: rule.domain,
      action: rule.action,
    }))

  return { rules }
}

export function isValidDomainPattern(pattern: string): boolean {
  if (!pattern || pattern.length === 0) {
    return false
  }

  if (pattern === '*') {
    return true
  }

  const wildcardSubdomain =
    /^\*\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/
  const exactDomain =
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/

  return wildcardSubdomain.test(pattern) || exactDomain.test(pattern)
}

function isValidRule(rule: NetworkPolicyRule): boolean {
  return isValidDomainPattern(rule.domain) && (rule.action === 'allow' || rule.action === 'deny')
}

export function validateNetworkPolicy(policy: NetworkPolicy): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!['allow-list', 'deny-list', 'unrestricted'].includes(policy.mode)) {
    errors.push(`Invalid mode: ${policy.mode}`)
  }

  if (!Array.isArray(policy.rules) || policy.rules.length === 0) {
    errors.push('Policy must have at least one rule')
    return { valid: false, errors }
  }

  policy.rules.forEach((rule) => {
    if (!isValidRule(rule)) {
      errors.push(`Invalid rule: ${JSON.stringify(rule)}`)
    }
  })

  const catchAllRuleIndex = policy.rules.findIndex((rule) => rule.domain === '*')
  if (catchAllRuleIndex === -1) {
    errors.push('Policy should include a catch-all (*) rule as the last entry')
  } else if (catchAllRuleIndex !== policy.rules.length - 1) {
    errors.push('Catch-all (*) rule must be the last entry')
  }

  return { valid: errors.length === 0, errors }
}
