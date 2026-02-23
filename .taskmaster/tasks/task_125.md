# Task ID: 125

**Title:** Create network policy presets data and validation utilities

**Status:** done

**Dependencies:** 124 ✓

**Priority:** high

**Description:** Implement the predefined policy presets (unrestricted, github-only, development, lockdown) and validation utilities for domain patterns and policy rules.

**Details:**

Create new file `packages/agent/src/network-policy.ts`:

```typescript
import { NetworkPolicy, NetworkPolicyRule, PolicyPreset } from './types';

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
    description: 'GitHub + npm + PyPI + common dev tools',
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
    description: 'Deny all external access',
    policy: {
      mode: 'deny-list',
      rules: [{ domain: '*', action: 'deny' }],
      presetId: 'lockdown',
    },
  },
];

export const DEFAULT_NETWORK_POLICY = NETWORK_POLICY_PRESETS.find(p => p.id === 'development')!.policy;

// Validation utilities
export function isValidDomainPattern(pattern: string): boolean {
  if (!pattern || pattern.length === 0) return false;
  if (pattern === '*') return true;
  // Allow wildcard subdomains: *.example.com
  const wildcardSubdomain = /^\*\.[a-zA-Z0-9][a-zA-Z0-9-]*(\.[a-zA-Z0-9][a-zA-Z0-9-]*)*$/;
  // Allow exact domain: example.com
  const exactDomain = /^[a-zA-Z0-9][a-zA-Z0-9-]*(\.[a-zA-Z0-9][a-zA-Z0-9-]*)*$/;
  return wildcardSubdomain.test(pattern) || exactDomain.test(pattern);
}

export function validateNetworkPolicy(policy: NetworkPolicy): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!['allow-list', 'deny-list', 'unrestricted'].includes(policy.mode)) {
    errors.push(`Invalid mode: ${policy.mode}`);
  }
  
  if (!Array.isArray(policy.rules) || policy.rules.length === 0) {
    errors.push('Policy must have at least one rule');
  }
  
  for (const rule of policy.rules) {
    if (!isValidDomainPattern(rule.domain)) {
      errors.push(`Invalid domain pattern: ${rule.domain}`);
    }
    if (!['allow', 'deny'].includes(rule.action)) {
      errors.push(`Invalid action: ${rule.action}`);
    }
  }
  
  // Warn if no catch-all rule
  const hasCatchAll = policy.rules.some(r => r.domain === '*');
  if (!hasCatchAll) {
    errors.push('Policy should include a catch-all (*) rule as the last entry');
  }
  
  return { valid: errors.length === 0, errors };
}

export function getPresetById(id: string): PolicyPreset | undefined {
  return NETWORK_POLICY_PRESETS.find(p => p.id === id);
}
```

Export from `packages/agent/src/index.ts`.

**Test Strategy:**

1. Unit test each preset exists and has valid structure
2. Test isValidDomainPattern with valid patterns: 'github.com', '*.npmjs.org', '*'
3. Test isValidDomainPattern with invalid patterns: '', '**', 'http://github.com', '*.*.com'
4. Test validateNetworkPolicy catches missing rules, invalid modes, and invalid actions
5. Test getPresetById returns correct preset or undefined
