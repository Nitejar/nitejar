# Task ID: 124

**Title:** Define NetworkPolicy TypeScript types and interfaces

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Create the core TypeScript type definitions for network policies including NetworkPolicy, NetworkPolicyRule, and PolicyPreset interfaces in the agent package.

**Details:**

Add the following types to `packages/agent/src/types.ts`:

```typescript
export type NetworkPolicyMode = 'allow-list' | 'deny-list' | 'unrestricted';

export interface NetworkPolicyRule {
  domain: string;        // e.g., 'github.com', '*.npmjs.org', '*'
  action: 'allow' | 'deny';
}

export interface NetworkPolicy {
  mode: NetworkPolicyMode;
  rules: NetworkPolicyRule[];
  presetId?: string;
  customized?: boolean;
}

export interface PolicyPreset {
  id: string;
  name: string;
  description: string;
  policy: NetworkPolicy;
}
```

Extend the existing `AgentConfig` interface to include:
```typescript
interface AgentConfig {
  // ... existing fields
  networkPolicy?: NetworkPolicy;
}
```

This approach stores networkPolicy in the existing agents.config JSON blob, avoiding database migrations per the PRD's Option A recommendation.

**Test Strategy:**

1. Add unit tests to verify type exports are accessible
2. Test that existing AgentConfig parsing still works with and without networkPolicy field
3. Verify TypeScript compilation succeeds with new types
4. Test that parseAgentConfig handles undefined networkPolicy gracefully
