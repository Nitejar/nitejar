# Agent Network Policy Configuration PRD

## Overview

Enable administrators to configure network access policies for agents, controlling which external domains and services each agent can reach from its Sprites sandbox. This provides security boundaries and compliance controls for agent execution.

## Problem Statement

Currently, agents have unrestricted network access from their sandboxes. This creates risks:

- Agents could access unintended external services
- No way to limit data exfiltration vectors
- No compliance controls for sensitive environments
- No differentiation between agent trust levels

## Goals

1. **Security**: Restrict agent network access to only necessary domains
2. **Flexibility**: Support per-agent policies, not just global rules
3. **Usability**: Provide sensible presets while allowing custom rules
4. **Visibility**: Show current policy state and blocked requests in admin UI

## Non-Goals

- IP-based filtering (Sprites API uses DNS-based filtering)
- Egress traffic inspection/logging (out of scope for v1)
- Rate limiting per domain (not supported by Sprites)
- Inbound network access controls (agents don't accept inbound connections)

---

## User Stories

### Administrator Stories

1. **As an admin**, I want to set a network policy for an agent so that it can only access approved domains
2. **As an admin**, I want to use policy presets (e.g., "GitHub only", "npm + GitHub", "Unrestricted") for quick configuration
3. **As an admin**, I want to add custom allow/deny rules beyond presets
4. **As an admin**, I want to see what policy is currently applied to an agent
5. **As an admin**, I want to copy a policy from one agent to another

### Developer/Operator Stories

1. **As a developer**, I want agents to have sensible default policies that don't break common workflows
2. **As an operator**, I want to understand why an agent's network request failed

---

## Detailed Requirements

### 1. Data Model

#### NetworkPolicy Schema

```typescript
interface NetworkPolicy {
  // Policy mode determines base behavior
  mode: "allow-list" | "deny-list" | "unrestricted"

  // Rules are evaluated in order; first match wins
  rules: NetworkPolicyRule[]

  // Optional preset ID if this policy is based on a preset
  presetId?: string

  // Whether custom rules have been added on top of a preset
  customized?: boolean
}

interface NetworkPolicyRule {
  domain: string // e.g., "github.com", "*.npmjs.org", "*"
  action: "allow" | "deny"
}
```

#### Storage Options (Choose One)

**Option A: Extend AgentConfig (Recommended for v1)**

- Store `networkPolicy` as a field within the existing `agents.config` JSON blob
- Pros: Simple, no schema migration, consistent with other agent settings
- Cons: Mixed concerns in single config object

**Option B: Separate Policy Table**

- New `agent_network_policies` table with `agent_id`, `policy_json`, `updated_at`
- Pros: Clean separation, audit trail, easier bulk operations
- Cons: Additional migration, join complexity

### 2. Policy Presets

Presets provide common configurations. Users can start with a preset and customize.

| Preset ID      | Name         | Description                            | Rules                              |
| -------------- | ------------ | -------------------------------------- | ---------------------------------- |
| `unrestricted` | Unrestricted | Full network access                    | `[{domain: "*", action: "allow"}]` |
| `github-only`  | GitHub Only  | GitHub API and git operations          | See below                          |
| `development`  | Development  | GitHub + npm + PyPI + common dev tools | See below                          |
| `lockdown`     | Lockdown     | Deny all external access               | `[{domain: "*", action: "deny"}]`  |

#### `github-only` Preset Rules

```json
[
  { "domain": "github.com", "action": "allow" },
  { "domain": "*.github.com", "action": "allow" },
  { "domain": "api.github.com", "action": "allow" },
  { "domain": "raw.githubusercontent.com", "action": "allow" },
  { "domain": "*.githubusercontent.com", "action": "allow" },
  { "domain": "*", "action": "deny" }
]
```

#### `development` Preset Rules

```json
[
  { "domain": "github.com", "action": "allow" },
  { "domain": "*.github.com", "action": "allow" },
  { "domain": "api.github.com", "action": "allow" },
  { "domain": "*.githubusercontent.com", "action": "allow" },
  { "domain": "registry.npmjs.org", "action": "allow" },
  { "domain": "*.npmjs.org", "action": "allow" },
  { "domain": "pypi.org", "action": "allow" },
  { "domain": "*.pypi.org", "action": "allow" },
  { "domain": "files.pythonhosted.org", "action": "allow" },
  { "domain": "crates.io", "action": "allow" },
  { "domain": "*.crates.io", "action": "allow" },
  { "domain": "*", "action": "deny" }
]
```

### 3. Admin UI

#### Location

New section in agent detail page: `apps/web/app/admin/agents/[id]/NetworkPolicySection.tsx`

#### UI Components

**Policy Overview Card**

- Shows current mode (Unrestricted / Allow List / Deny List)
- Indicates if based on preset (with preset name)
- Shows rule count and quick summary

**Preset Selector**

- Dropdown/card grid to select a preset
- Preview of what rules the preset includes
- "Apply Preset" button (warns if overwriting custom rules)

**Rules Editor**

- Sortable list of current rules
- Each rule shows: domain pattern, action (allow/deny), delete button
- "Add Rule" form with domain input and action toggle
- Drag to reorder (first match wins)

**Domain Pattern Help**

- Tooltip explaining patterns:
  - `example.com` - exact domain match
  - `*.example.com` - any subdomain
  - `*` - wildcard (all domains)

**Actions**

- Save Changes button
- Reset to Preset button (if customized)

### 4. API / tRPC Endpoints

#### tRPC Router: `networkPolicy`

```typescript
// Get current policy for an agent
networkPolicy.get: (agentId: string) => NetworkPolicy | null

// Set policy for an agent (syncs to Sprites API)
networkPolicy.set: (agentId: string, policy: NetworkPolicy) => void

// List available presets
networkPolicy.listPresets: () => PolicyPreset[]

// Apply a preset to an agent
networkPolicy.applyPreset: (agentId: string, presetId: string) => void
```

### 5. Sprites API Integration

#### Sync Flow

When a network policy is saved:

1. Validate the policy (check domain patterns, ensure rules array is valid)
2. Save to local database (agents.config or separate table)
3. If agent has an active sprite (`sprite_id` is set):
   - Call Sprites API: `POST /v1/sprites/{sprite_name}/policy/network`
   - Handle errors (sprite not found, invalid rules)
4. Return success/failure to UI

#### On Sprite Provisioning

When a new sprite is created for an agent:

1. Check if agent has a saved network policy
2. If yes, apply it via Sprites API
3. If no, apply default policy (configurable: unrestricted or development preset)

#### Policy Format Translation

Our internal format maps directly to Sprites API format:

```typescript
// Internal
{ rules: [{domain: "github.com", action: "allow"}, ...] }

// Sprites API (same structure)
{ rules: [{domain: "github.com", action: "allow"}, ...] }
```

### 6. Default Behavior

- **New agents**: Apply `development` preset by default
- **Existing agents** (migration): Leave as `unrestricted` to avoid breaking changes
- Presets are shown as options during agent creation and in the edit UI

---

## Implementation Plan

### Phase 1: Core Backend

1. Add `networkPolicy` field to AgentConfig type
2. Create NetworkPolicy types and validation
3. Create policy presets data
4. Add Sprites API integration for policy sync
5. Add tRPC endpoints for get/set/list presets

### Phase 2: Admin UI

1. Create NetworkPolicySection component
2. Add preset selector with preview
3. Add rules editor with drag-to-reorder
4. Wire up to tRPC endpoints
5. Add confirmation dialogs for destructive actions

### Phase 3: Polish & Testing

1. Add policy status indicator to agent list view
2. Integration tests for policy sync
3. Error handling and user feedback

---

## Technical Considerations

### Caching

- Sprites API applies policies immediately; no caching concerns on their end
- Our UI should refresh policy state after save to confirm sync

### Error Handling

- If Sprites API call fails, show error but still save locally
- Provide "Retry Sync" action if local and remote are out of sync
- Log sync failures for debugging

### Domain Pattern Validation

- Reject invalid patterns (e.g., empty string, multiple wildcards)
- Warn on overly permissive patterns (single `*` rule)

### Audit Trail (Future)

- Consider logging policy changes with timestamp and actor
- Could be added to existing audit log system if present

---

## Success Metrics

1. **Adoption**: % of agents with non-default policies
2. **Usability**: Time to configure a policy (target: <30 seconds with preset)
3. **Reliability**: Policy sync success rate (target: >99%)
4. **Security**: Reduction in agents with unrestricted access

---

## Decisions

1. **Default policy for new agents**: `development` preset (more secure by default)
2. **Bulk policy management**: Out of scope for v1
3. **Policy inheritance**: Out of scope for v1
4. **Blocked request visibility**: Not available from Sprites API directly. Blocked requests would surface as errors in tool calls (e.g., `curl` failures), which is sufficient for v1

---

## Appendix: Sprites Policy API Reference

### Get Network Policy

```
GET /v1/sprites/{name}/policy/network
```

### Set Network Policy

```
POST /v1/sprites/{name}/policy/network
Content-Type: application/json

{
  "rules": [
    {"domain": "github.com", "action": "allow"},
    {"domain": "*.npmjs.org", "action": "allow"},
    {"domain": "*", "action": "deny"}
  ]
}
```

Response: Returns the applied policy rules.

### Rule Evaluation

- Rules are evaluated in order
- First matching rule determines action
- If no rule matches, behavior is undefined (always include a catch-all `*` rule)
- Wildcard `*.example.com` matches subdomains but NOT `example.com` itself
