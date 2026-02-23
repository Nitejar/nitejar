# Task ID: 136

**Title:** Document network policy feature and update API documentation

**Status:** pending

**Dependencies:** 135 ✓

**Priority:** low

**Description:** Add inline code documentation, update any existing API docs, and ensure the feature is well-documented for future developers.

**Details:**

Add comprehensive JSDoc comments to key functions and types:

```typescript
// In packages/agent/src/types.ts:

/**
 * Network access control mode for agent sandboxes.
 * - 'allow-list': Only explicitly allowed domains are accessible
 * - 'deny-list': All domains accessible except explicitly denied ones
 * - 'unrestricted': No network restrictions (not recommended for production)
 */
export type NetworkPolicyMode = 'allow-list' | 'deny-list' | 'unrestricted';

/**
 * A single rule in a network policy. Rules are evaluated in order;
 * the first matching rule determines whether a request is allowed or denied.
 * 
 * @example
 * // Allow all GitHub domains
 * { domain: '*.github.com', action: 'allow' }
 * 
 * @example
 * // Deny all (catch-all rule, typically placed last)
 * { domain: '*', action: 'deny' }
 */
export interface NetworkPolicyRule {
  /** 
   * Domain pattern to match. Supports:
   * - Exact match: 'api.github.com'
   * - Wildcard subdomain: '*.github.com' (matches subdomains but not root)
   * - Catch-all: '*' (matches any domain)
   */
  domain: string;
  
  /** Whether to allow or deny requests to matching domains */
  action: 'allow' | 'deny';
}

/**
 * Network policy configuration for an agent's Sprites sandbox.
 * Controls which external domains the agent can access during execution.
 * 
 * @see https://docs.sprites.ai/policies/network for Sprites API reference
 */
export interface NetworkPolicy {
  mode: NetworkPolicyMode;
  rules: NetworkPolicyRule[];
  
  /** ID of the preset this policy is based on, if any */
  presetId?: string;
  
  /** True if custom rules have been added on top of a preset */
  customized?: boolean;
}
```

Add README section or update existing docs:

```markdown
## Network Policies

Agents can have network policies that restrict which external domains they can access from their Sprites sandbox.

### Presets

- **Unrestricted**: Full network access (not recommended)
- **GitHub Only**: Only GitHub-related domains
- **Development**: GitHub + npm + PyPI + crates.io
- **Lockdown**: No external network access

### Custom Rules

Rules are evaluated in order. First matching rule wins. Always include a catch-all (`*`) rule as the last entry.

### API

```typescript
// Get agent's policy
trpc.networkPolicy.get({ agentId })

// Set custom policy
trpc.networkPolicy.set({ agentId, policy })

// Apply a preset
trpc.networkPolicy.applyPreset({ agentId, presetId: 'development' })

// List available presets
trpc.networkPolicy.listPresets()
```
```

Ensure all exported functions have clear parameter and return type documentation.

**Test Strategy:**

1. Run TypeScript compilation to verify JSDoc doesn't break types
2. Review documentation renders correctly in IDE tooltips
3. Ensure code examples in docs are accurate and up-to-date
4. Have another developer review docs for clarity
5. Verify any external API references (Sprites docs) are correct
