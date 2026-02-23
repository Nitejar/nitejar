# WS5: Agent Builder & Shareable Agents

Status: Draft
Audience: Core engineering, product, community
Last updated: 2026-02-20

---

## 1. Overview

### What the Agent Builder is

Nitejar has full agent CRUD in the admin UI today: identity (name, handle, emoji, avatar), soul/personality (markdown editor), model configuration, memory settings, session tuning, network policy, cost limits, sandbox catalog, and plugin instance assignments. All of this lives across separate section-based forms on the agent detail page (`/admin/agents/[id]`). The create flow (`/admin/agents/new`) only captures identity and team assignment, then redirects to the detail page where operators manually configure each section one at a time.

The Agent Builder is a guided wizard that replaces the "create then configure" pattern with a single, step-by-step flow. An operator starts the wizard, walks through each configuration facet in order, optionally tests the agent in a live conversation, and saves a fully configured agent in one pass.

### What Shareable Agents enable

Shareable Agents introduce a portable JSON format (`.nitejar-agent.json`) that captures an agent's full configuration -- everything needed to recreate the agent on a different Nitejar instance, minus secrets and instance-specific identifiers. This enables:

1. **Export/Import** -- Back up an agent configuration, move it between dev/staging/prod instances, or duplicate it with modifications. This is a core v1 feature.
2. **Community sharing** -- Publish agent profiles that others can import. A "GitHub PR reviewer" or "Telegram ops bot" profile can be shared as a `.nitejar-agent.json` file and imported with one click. For v1, sharing is file-based (out-of-band); a future registry will formalize discovery.
3. **Version control** -- Store agent profiles in git alongside the infrastructure that runs them.
4. **Templates** -- Agent templates are NOT bundled in the Nitejar codebase. The wizard provides soul presets (personality starting points), but full agent profiles are user-created and shared externally via the `.nitejar-agent.json` format.

---

## 2. Agent Profile Format

### 2.1 The `.nitejar-agent.json` schema

The portable format captures the configuration fields that define agent behavior. It is a strict JSON file with a well-known structure.

```jsonc
{
  // Format metadata
  "$schema": "https://nitejar.dev/schemas/agent-profile/v1.json",
  "formatVersion": 1,
  "exportedAt": "2026-02-20T12:00:00Z",
  "exportedFrom": "nitejar/1.0.0",

  // Identity
  "identity": {
    "name": "Mary",            // Display name (required)
    "handle": "mary",          // @mention slug (required, must be unique at import time)
    "title": "Sr Eng",         // Role description (optional)
    "emoji": "🤖",             // Avatar emoji (optional)
    "avatarUrl": null           // Avatar image URL (optional, may be null)
  },

  // Soul -- the full markdown personality document
  "soul": "# Soul\n\n## Who You Are\n...",

  // Model preferences
  "model": {
    "preferred": "arcee-ai/trinity-large-preview:free",
    "temperature": 0.7,
    "maxTokens": 4096,
    "editToolMode": "hashline"
  },

  // Memory settings (declarative, not memory content)
  "memorySettings": {
    "enabled": true,
    "maxMemories": 15,
    "decayRate": 0.1,
    "reinforceAmount": 0.2,
    "similarityWeight": 0.5,
    "minStrength": 0.1
  },

  // Session settings
  "sessionSettings": {
    "enabled": true,
    "maxTurns": 30,
    "maxTokens": 12000,
    "resetTriggers": ["/clear"],
    "idleTimeoutMinutes": 120,
    "dailyResetHour": null,
    "clearMemoriesOnReset": false,
    "compaction": {
      "enabled": true,
      "summaryMaxTokens": 500,
      "extractMemories": false,
      "loadPreviousSummary": true
    },
    "messageEmbeddings": true
  },

  // Network policy
  "networkPolicy": {
    "mode": "allow-list",
    "presetId": "development",
    "customized": false,
    "rules": [
      { "domain": "github.com", "action": "allow" },
      { "domain": "*.github.com", "action": "allow" },
      { "domain": "registry.npmjs.org", "action": "allow" },
      { "domain": "*", "action": "deny" }
    ]
  },

  // Triage settings
  "triageSettings": {
    "maxTokens": 4000,
    "reasoningEffort": null,
    "recentHistoryMaxChars": 20000,
    "recentHistoryLookbackMessages": 250,
    "recentHistoryPerMessageMaxChars": 500
  },

  // Queue behavior
  "queue": {
    "mode": "steer",
    "debounceMs": 3000,
    "maxQueued": 20
  },

  // Feature flags
  "features": {
    "allowEphemeralSandboxCreation": true,
    "allowRoutineManagement": false
  },

  // Plugin requirements (declarative -- says what plugins the agent expects)
  "pluginRequirements": [
    {
      "pluginId": "builtin.telegram",
      "required": true,
      "note": "Telegram is the primary communication channel."
    },
    {
      "pluginId": "builtin.github",
      "required": false,
      "note": "Optional GitHub integration for PR workflows."
    }
  ],

  // Cost limits (declarative template -- applied at import time)
  "costLimits": [
    {
      "period": "daily",
      "limitUsd": 5.00,
      "softLimitPct": 80,
      "hardLimitPct": 150
    }
  ],

  // Skill attachments (declarative -- references skills by slug, not ID)
  "skillAttachments": [
    { "skillSlug": "jira-triage", "priority": 0, "autoInject": false },
    { "skillSlug": "code-review", "priority": 1, "autoInject": true }
  ],

  // Seed memories (optional -- permanent memories to inject at import time)
  "seedMemories": [
    {
      "content": "FACT: I prefer concise responses over verbose ones.",
      "permanent": true
    }
  ]
}
```

### 2.2 Fields that are INCLUDED

| Category | Fields | Notes |
|----------|--------|-------|
| Identity | `name`, `handle`, `title`, `emoji`, `avatarUrl` | `handle` is advisory; importer can rename on conflict |
| Soul | Full markdown document | Exported verbatim |
| Model | `preferred` model ID, `temperature`, `maxTokens`, `editToolMode` | Model ID is a preference; importer falls back if unavailable |
| Memory settings | All `MemorySettings` fields | Declarative knobs, not memory content |
| Session settings | All `SessionSettings` + `CompactionSettings` | Full session tuning |
| Network policy | `mode`, `rules[]`, `presetId`, `customized` | Full policy definition |
| Triage settings | All `TriageSettings` fields | Lightweight classifier config |
| Queue settings | `mode`, `debounceMs`, `maxQueued` | Per-agent queue behavior |
| Feature flags | `allowEphemeralSandboxCreation`, `allowRoutineManagement` | Boolean toggles |
| Plugin requirements | Array of `{ pluginId, required, note }` | Declarative; does not carry plugin config |
| Cost limits | Array of `{ period, limitUsd, softLimitPct, hardLimitPct }` | Template; IDs generated at import |
| Skill attachments | Array of `{ skillSlug, priority, autoInject }` | Skill assignments by slug. On import, matched to local skills by slug; missing skills produce a warning. |
| Seed memories | Array of `{ content, permanent }` | Bootstrapping memories for fresh agents |

### 2.3 Fields that are NOT included

| Excluded | Reason |
|----------|--------|
| Agent `id` | Generated fresh on import |
| `sprite_id` | Instance-specific; provisioned on first run |
| Plugin instance IDs | Instance-specific; operator must configure plugin instances separately |
| Plugin instance config / secrets | Security: encrypted API keys, tokens, webhook secrets must never be exported |
| Credential vault entries | Security: `credentials` and `agent_credentials` rows contain encrypted secrets |
| Actual memory content (non-seed) | Privacy: learned memories are instance-specific and may contain user data |
| Session history / messages | Privacy and size: transactional data stays local |
| Work items, jobs, inference calls | Transactional data; not part of agent configuration |
| Team assignments | Org-specific; operator assigns teams after import |
| Sandbox state | Runtime state; sandboxes are provisioned on demand |
| Routine definitions | Instance-specific: routines reference plugin instance IDs and session keys |
| Rubric assignments | Operational concern; evaluators are assigned after observing agent behavior, not at creation time |
| `systemPrompt` (legacy field) | Deprecated; `soul` is the canonical personality field |
| `created_at`, `updated_at` | Regenerated at import time |

---

## 3. Export Flow

### 3.1 User experience

1. Navigate to `/admin/agents/[id]` (agent detail page).
2. Click "Export Profile" button in the agent header area (next to the status toggle).
3. The system generates a `.nitejar-agent.json` file.
4. Browser triggers a download: `{handle}.nitejar-agent.json`.

### 3.2 Data sanitization

The export procedure:

1. Reads the agent row and parses `config` JSON.
2. Reads cost limits for the agent (scope = 'agent').
3. Reads permanent memories to populate `seedMemories` (content only, no embeddings or IDs).
4. Reads plugin instance assignments to build `pluginRequirements` (plugin type and name only, no config).
5. Assembles the profile JSON per the schema in Section 2.1.
6. Strips any `undefined` or `null` optional fields for clean output.
7. Does NOT read or include: credentials, session history, work items, routine definitions, sandbox details.

### 3.3 tRPC endpoint

```
org.exportAgentProfile
  Input:  { agentId: string, includeSeedMemories?: boolean }
  Output: { profile: AgentProfile, filename: string }
```

The client calls this endpoint and triggers a client-side download of the JSON payload. No server-side file creation.

---

## 4. Import Flow

### 4.1 User experience

1. Navigate to `/admin/agents` (agent list page).
2. Click "Import Agent" button (alongside the existing "Create Agent" button).
3. File picker opens, accepting `.nitejar-agent.json` files.
4. System parses the file and shows a **preview panel**:
   - Agent name, handle, emoji, title.
   - Model preference (with a warning badge if the model is not in the local catalog).
   - Plugin requirements (with status badges: "installed", "not installed", "not required").
   - Skill attachments (with status badges: "available", "not found").
   - Cost limit summary.
   - Seed memory count.
5. **Handle conflict resolution**: If the handle already exists, show a text field to enter a new handle. Auto-suggest `{handle}-2` or similar.
6. **Model fallback**: If the preferred model is not available, show the current default model as the fallback. Operator can pick a different one.
7. **Plugin warning**: If a required plugin is not installed, show a yellow warning. Import still proceeds; the agent just won't have that integration until the plugin is installed and a plugin instance is created and assigned.
8. Operator clicks "Import Agent" to confirm.
9. System creates the agent with all configuration, applies cost limits, inserts seed memories.
10. Redirect to the new agent's detail page.

### 4.2 Dependency handling

| Dependency | Resolution |
|------------|------------|
| Handle conflict | Prompt operator to choose a new handle |
| Model not found | Fall back to `getDefaultModel()`, show warning |
| Plugin not installed | Show warning, skip assignment, agent works without it |
| Plugin installed but no instance | Show info, suggest creating an instance post-import |
| Skill slug not found | Show warning, skip skill attachment, agent works without it |
| Network policy preset not recognized | Apply rules as custom policy, ignore `presetId` |
| Format version mismatch | Reject if `formatVersion > supported`. Import uses Zod schema validation (`.passthrough()` for forward compat). v2 importers MUST be able to read v1 files. |

### 4.3 tRPC endpoint

```
org.importAgentProfile
  Input: {
    profile: AgentProfile,        // The parsed JSON
    handleOverride?: string,      // If handle conflicts
    modelOverride?: string,       // If preferred model unavailable
    teamId?: string,              // Optional team assignment
    skipSeedMemories?: boolean    // If operator wants to skip
  }
  Output: { agentId: string }
```

Validation is server-side. The client does file reading and JSON parsing, then sends the parsed object to the server.

---

## 5. Agent Builder Wizard

### 5.1 Design philosophy

The builder is a multi-step wizard that walks an operator through agent configuration. Each step is independently saveable and skippable. The wizard layout follows the existing plugin install wizard pattern (`PluginInstallWizard.tsx`) -- a single client component with flow state management, not separate routes per step.

The wizard should feel more like "shaping someone" and less like "filling out a form." Steps are ordered from most creative (identity, personality) to most technical (model tuning, network policy).

### 5.2 Step breakdown

#### Step 1: Name & Purpose

**What the operator does:**
- Enter display name (required)
- Enter handle / @mention ID (required, validated: `^[a-zA-Z0-9_-]+$`)
- Enter title/role (optional)
- Pick emoji or upload avatar URL
- Optionally assign to a team

**UI layout:** Single card, similar to the current `NewAgentClient.tsx` form but embedded in the wizard frame.

**State:** `{ name, handle, title, emoji, avatarUrl, teamId }`

#### Step 2: Soul / Personality

**What the operator does:**
- Pick a **soul preset** from a selector, or start from blank
- Edit the resulting soul markdown document in the editor

**Soul presets:** Shipped as static TS constants (not stored in the DB). Each preset provides a starting soul document that the operator can customize after selection. Presets:

| Preset | Flavor |
|--------|--------|
| Creative | Imaginative, expressive, favors novel approaches |
| Engineer | Precise, technical, favors correctness and clarity |
| Marketer | Persuasive, audience-aware, favors engagement |
| CEO | Strategic, decisive, favors big-picture thinking |
| First-level Support | Patient, empathetic, favors step-by-step resolution |
| Analyst | Data-driven, methodical, favors evidence and metrics |
| Community Manager | Warm, inclusive, favors relationship-building |

Presets live in `apps/web/lib/soul-presets.ts` as a `SOUL_PRESETS` array of `{ id, label, description, soul: string }` objects. The wizard Step 2 renders a card grid of presets above the editor. Selecting a preset populates the editor; further edits are freeform.

**UI layout:** Preset selector (card grid) above a full-width CodeMirror markdown editor, identical to the current `SoulSection.tsx` component but without the save button (save happens at the end of the wizard).

**State:** `{ soul: string, soulPresetId?: string }`

#### Step 3: Model & Budget

**What the operator does:**
- Select a model from the model catalog (using the existing `ModelSelect` component)
- Set temperature and max tokens
- Set edit tool mode (hashline/replace)
- Optionally add cost limits (period, amount, soft/hard thresholds)

**UI layout:** Model select dropdown + parameter sliders/inputs on top. Cost limits as an "Add limit" repeatable row below.

**State:** `{ model, temperature, maxTokens, editToolMode, costLimits[] }`

Triage settings are intentionally omitted from the wizard. They are an advanced tuning concern best handled on the detail page after the agent is operational.

#### Step 4: Capabilities & Plugins

**What the operator does:**
- See a checklist of available plugin types (builtin: Telegram, GitHub; installed custom plugins)
- Toggle which plugins this agent should be assigned to
- For each toggled plugin, select an existing plugin instance or note that one needs to be created
- Toggle feature flags: ephemeral sandbox creation, routine management

**UI layout:** Plugin list with toggle switches and instance dropdowns. Feature flags as a separate sub-section with toggle switches.

**State:** `{ pluginAssignments: { pluginInstanceId, enabled }[], features: { allowEphemeralSandboxCreation, allowRoutineManagement } }`

#### Step 5: Skills

**What the operator does:**
- Browse available skills from the skill catalog
- Toggle skills on/off for the agent
- Set priority (numeric, lower = higher priority) and auto-inject (boolean) per attached skill
- Auto-inject skills are included in every agent run; non-auto-inject skills are available on demand

**UI layout:** Reuses the `SkillsSection` component from WS3. A searchable list of catalog skills with toggle switches. Each enabled skill expands to show priority and auto-inject controls. Skills are displayed with their slug, display name, and description.

**State:** `{ skillAttachments: Array<{ skillSlug: string, priority: number, autoInject: boolean }> }`

#### Step 6: Network Policy

**What the operator does:**
- Pick a preset (Unrestricted, GitHub Only, Development, Lockdown) or configure custom rules
- Review the resulting rule list
- Edit individual rules if customizing

**UI layout:** Preset selector (radio cards) + expandable rule editor. Mirrors the current `NetworkPolicySection.tsx` but in a wizard step context.

**State:** `{ networkPolicy: NetworkPolicy }`

#### Step 7: Test Conversation (optional)

**What the operator does:**
- Chat with a temporary agent instance to verify behavior
- The instance uses the configuration from the previous steps
- Messages appear in a chat-style panel
- Operator can go back to previous steps to adjust, then return to test again
- This step can be skipped entirely

**Temp agent lifecycle:**

1. **Creation.** When the operator enters Step 7 for the first time, the wizard calls `agentBuilder.createTestAgent`. This creates a real agent row in the DB with `published: false` and a random handle (e.g., `_test-a7f3b2`). The random handle uses the pattern `_test-{nanoid(6)}` to avoid collisions with real handles. The temp agent is fully disconnected from incoming data -- no plugin instances are assigned, no webhooks route to it. The only way to interact with it is via the wizard chat interface.
2. **Chat.** The wizard renders a chat panel. Each message is sent via `agentBuilder.sendTestMessage`, which creates a work item and runs the standard inference loop against the temp agent. The temp agent's config is kept in sync with the wizard state -- if the operator goes back and changes the soul or model, the temp agent config is updated before the next message.
3. **Config sync.** When the operator navigates back to a previous step and returns to Step 7, the wizard calls `agentBuilder.updateTestAgentConfig` to push the latest wizard state to the temp agent record. The chat history is preserved.
4. **Promotion.** On wizard save ("Create Agent"), the temp agent is promoted: its `published` flag is set to `true`, the random handle is replaced with the real handle from Step 1, and plugin instances / team / cost limits are applied. The promoted agent keeps its ID and any test conversation history.
5. **Cleanup on close.** If the operator navigates away or closes the wizard without saving, the client calls `agentBuilder.cleanupTestAgent` (best-effort, fires on `beforeunload` and route change). This deletes the temp agent and its associated work items / messages / memories.
6. **Background sweep.** A background sweep runs periodically (e.g., every 30 minutes via the existing worker loop) and deletes any `published: false` agents with a `_test-` handle prefix that are older than 1 hour. This catches orphaned temp agents from crashed browsers or missed cleanup calls. The sweep is implemented as a function in `apps/web/server/services/agent-builder-cleanup.ts` and called from the existing periodic worker.

**UI layout:** Chat panel (left: messages, right: agent config summary sidebar).

**State:** `{ testSessionId?: string, testAgentId?: string }`

#### Step 8: Review & Save

**What the operator does:**
- See a summary of all configured values
- Each section is collapsible with an "Edit" link that navigates back to the relevant step
- Click "Create Agent" to finalize

**UI layout:** Stacked summary cards. Each card shows key values from a step. "Create Agent" primary button at bottom.

**On save:**
1. **If test conversation was used:** Call `agentBuilder.promoteTestAgent` to set the temp agent to `published: true`, apply the real handle, team, plugin assignments, and cost limits. The promoted agent keeps its existing ID and test conversation history.
2. **If test conversation was NOT used:** Create a new agent record with full config JSON.
3. Create home sandbox.
4. Apply team assignment if specified (handled by promote if test agent path).
5. Create cost limit records if specified (handled by promote if test agent path).
6. Assign plugin instances if specified (handled by promote if test agent path).
7. Redirect to `/admin/agents/[id]`.

### 5.3 Wizard navigation

- **Step indicator** at the top: horizontal numbered steps with labels. Current step highlighted. Completed steps show a checkmark.
- **Next / Back buttons** at the bottom of each step.
- **Steps are independently visitable** after the first pass: clicking a completed step in the indicator navigates back to it.
- **Step 1 is the only mandatory step.** All other steps have sensible defaults. The operator can click "Skip to Review" from any step.

### 5.4 Wizard state management

All wizard state lives in a single React `useState` or `useReducer` in the wizard client component. No server-side draft persistence (except for the test conversation step, which creates temporary DB records). If the operator navigates away, state is lost and the wizard resets. This is intentional simplicity for v1.

---

## 6. tRPC Routes

### 6.1 New routes on `org` router

```typescript
// Export agent configuration as a portable profile
org.exportAgentProfile
  Input:  { agentId: string, includeSeedMemories?: boolean }
  Output: { profile: AgentProfileV1, filename: string }

// Import an agent from a portable profile
org.importAgentProfile
  Input:  {
    profile: AgentProfileV1,
    handleOverride?: string,
    modelOverride?: string,
    teamId?: string,
    skipSeedMemories?: boolean
  }
  Output: { agentId: string }

// Validate a profile without importing (used by the preview panel)
org.validateAgentProfile
  Input:  { profile: AgentProfileV1 }
  Output: {
    valid: boolean,
    errors: string[],
    warnings: string[],
    handleConflict: boolean,
    modelAvailable: boolean,
    pluginStatus: Array<{ pluginId: string, installed: boolean, hasInstance: boolean }>,
    skillStatus: Array<{ skillSlug: string, available: boolean }>
  }
```

### 6.2 New routes for test conversation (`agentBuilder` router)

```typescript
// Create a temporary agent for testing in the builder.
// The agent is created with published: false and a random _test-{nanoid} handle.
agentBuilder.createTestAgent
  Input:  { config: Partial<AgentConfig>, identity: { name, handle, ... } }
  Output: { testAgentId: string, testSessionKey: string }

// Update the temp agent's config (called when operator changes wizard state and returns to test step)
agentBuilder.updateTestAgentConfig
  Input:  { testAgentId: string, config: Partial<AgentConfig>, identity?: { name, title, emoji, avatarUrl } }
  Output: { ok: boolean }

// Send a message to the test agent
agentBuilder.sendTestMessage
  Input:  { testAgentId: string, testSessionKey: string, message: string }
  Output: { jobId: string }

// Clean up test agent resources (deletes agent, work items, messages, memories)
agentBuilder.cleanupTestAgent
  Input:  { testAgentId: string }
  Output: { ok: boolean }

// Promote a test agent to a real agent (sets published: true, applies real handle/team/plugins)
agentBuilder.promoteTestAgent
  Input:  {
    testAgentId: string,
    finalIdentity: { name: string, handle: string, title?: string, emoji?: string, avatarUrl?: string },
    finalConfig: AgentConfig,
    teamId?: string,
    pluginAssignments?: Array<{ pluginInstanceId: string }>,
    skillAttachments?: Array<{ skillSlug: string, priority: number, autoInject: boolean }>,
    costLimits?: Array<{ period: string, limitUsd: number, softLimitPct: number, hardLimitPct: number }>
  }
  Output: { agentId: string }

// List orphaned temp agents (for admin diagnostics; the background sweep uses this internally)
agentBuilder.listTempAgents
  Input:  { olderThanMinutes?: number }
  Output: { agents: Array<{ id: string, handle: string, createdAt: string }> }
```

### 6.3 Route placement

New routes live in:
- `apps/web/server/routers/org.ts` for export/import/validate (extends existing `orgRouter`)
- `apps/web/server/routers/agent-builder.ts` for test conversation and temp agent lifecycle (new router)

The new router is wired through `_app.ts`:

```typescript
export const appRouter = router({
  // ... existing
  agentBuilder: agentBuilderRouter,
})
```

---

## 7. Admin UI Components

### 7.1 Wizard shell

**File:** `apps/web/app/admin/agents/builder/AgentBuilderWizard.tsx`

A client component (`'use client'`) that:
- Manages wizard state with `useReducer`
- Renders a step indicator bar (horizontal, numbered)
- Renders the current step's content
- Renders Next/Back/Skip navigation

**Route:** `/admin/agents/builder` (new page, sits alongside `/admin/agents/new`)

### 7.2 Step components

Each step is a standalone component that receives wizard state and dispatches updates:

| Step | Component File | Reuses |
|------|---------------|--------|
| 1. Name & Purpose | `IdentityStep.tsx` | Emoji picker, avatar input from `NewAgentClient.tsx` |
| 2. Soul | `SoulStep.tsx` | Preset selector (card grid) + CodeMirror editor from `SoulSection.tsx`. Presets from `apps/web/lib/soul-presets.ts` |
| 3. Model & Budget | `ModelBudgetStep.tsx` | `ModelSelect` component, cost limit inputs |
| 4. Capabilities | `CapabilitiesStep.tsx` | Plugin instance query, agent assignment toggles |
| 5. Skills | `SkillsStep.tsx` | `SkillsSection` component from WS3; skill catalog query, priority/auto-inject controls |
| 6. Network Policy | `NetworkPolicyStep.tsx` | Preset selector and rule editor from `NetworkPolicySection.tsx` |
| 7. Test Conversation | `TestConversationStep.tsx` | New: chat UI, message list, input box |
| 8. Review & Save | `ReviewStep.tsx` | Summary cards, collapsible sections |

### 7.3 Import dialog

**File:** `apps/web/app/admin/agents/ImportAgentDialog.tsx`

A modal dialog triggered from the agent list page:
- File drop zone (`.nitejar-agent.json`)
- Preview panel (parsed profile summary)
- Handle conflict resolver
- Model fallback selector
- Import confirmation button

### 7.4 Export button

**File:** Inline in `apps/web/app/admin/agents/[id]/page.tsx`

An "Export Profile" button added to the agent detail page header, next to the existing status toggle. Calls `org.exportAgentProfile` and triggers a client-side download.

### 7.5 Entry points

| Location | Action | Target |
|----------|--------|--------|
| `/admin/agents` (agent list) | "Create Agent" button | `/admin/agents/builder` (new wizard) |
| `/admin/agents` (agent list) | "Import Agent" button | Opens `ImportAgentDialog` |
| `/admin/agents/[id]` (detail) | "Export Profile" button | Client-side download |
| `/admin/agents/new` | Kept as-is (quick create) | Existing simple form |

The existing `/admin/agents/new` quick-create flow remains available for operators who want to create a bare agent and configure it later. The wizard is the recommended path but not the only path.

---

## 8. Cross-Instance Sharing & Community Gallery

### 8.1 Sharing model (v1 -- core)

The `.nitejar-agent.json` file IS the sharing protocol for v1. There is no bundled template gallery and no remote registry. Sharing works like this:

1. Operator exports an agent from their instance (Section 3).
2. The `.nitejar-agent.json` file is shared out-of-band: posted in a Slack channel, committed to a git repo, uploaded to a blog post, shared in a Discord server, etc.
3. Another operator imports the file into their instance (Section 4).

Agent templates are NOT bundled in the Nitejar codebase. The soul presets in Step 2 of the wizard (Section 5.2) provide starting personalities, but full agent profiles are always user-created and shared externally.

### 8.2 Import dependency handling

When importing a `.nitejar-agent.json` from another instance, the import flow must handle missing dependencies gracefully:

| Missing dependency | Behavior |
|--------------------|----------|
| Plugin type not installed | Show warning badge ("plugin not installed"). Import proceeds; agent works without that plugin. Operator can install the plugin and assign an instance later. |
| Plugin installed but no instance configured | Show info badge ("no instance configured"). Suggest creating a plugin instance post-import. |
| Skill slug in `skillAttachments` not found locally | Show warning badge ("skill not found"). Import proceeds; the attachment is skipped. Operator can attach the skill later if it becomes available. |
| Skill referenced in soul doc not available | No validation -- soul is freeform markdown. The agent will simply not have access to that skill. |
| Model from a provider with no API key | Show warning badge ("provider not configured"). Fall back to default model. |
| Network policy preset not recognized | Apply raw rules as custom policy, ignore unrecognized `presetId`. |
| `formatVersion` higher than supported | Reject import with a clear error ("This profile requires a newer version of Nitejar"). |
| Unknown fields in profile JSON | Ignore unknown fields, log a warning. Zod `.passthrough()` on the schema. |

### 8.3 Community gallery (future)

A public registry of agent profiles that Nitejar users can browse, preview, and import. Think "Docker Hub for agent configurations." This is NOT part of v1.

**Registry format (future).** Agent profiles in the registry are `.nitejar-agent.json` files hosted in a git repository or served from an HTTP API. Each profile is accompanied by metadata:

```jsonc
{
  "id": "github-reviewer",
  "displayName": "GitHub PR Reviewer",
  "description": "Reviews pull requests with attention to code quality and security.",
  "author": "nitejar",
  "tags": ["github", "code-review", "security"],
  "profileUrl": "https://profiles.nitejar.dev/github-reviewer.nitejar-agent.json",
  "thumbnailEmoji": "🔍",
  "downloads": 142,
  "updatedAt": "2026-02-15T00:00:00Z"
}
```

**Discovery (future).**

- A "Gallery" tab on the agent list page shows community profiles.
- Search by name, tag, or description.
- Each gallery card shows: name, description, emoji, required plugins, model preference.
- "Use this profile" button opens the import flow pre-filled with the downloaded profile.

**Roadmap:**

- v1: `.nitejar-agent.json` file-based sharing (export/import only). No bundled templates, no registry.
- v2: Fetch from a remote registry (GitHub repo or API).
- v3: Allow users to publish their own profiles (requires auth, moderation).

---

## 9. Relationship to Existing Agent CRUD

### 9.1 Coexistence, not replacement

The Agent Builder wizard does NOT replace the current create flow (`/admin/agents/new`) or the detail page (`/admin/agents/[id]`). Both continue to work as they do today.

The relationship:

| Flow | Purpose | When to use |
|------|---------|-------------|
| Quick Create (`/admin/agents/new`) | Create a minimal agent (name + handle) and configure later | Fast iteration, advanced users who know what they want |
| Agent Builder Wizard | Guided step-by-step creation with all config | New users, onboarding, creating fully configured agents |
| Agent Detail Page | Edit any aspect of an existing agent | Post-creation tuning, ongoing management |
| Import | Instantiate a pre-built profile | Deploying known-good configs, community profiles |
| Export | Capture current config as a portable file | Backup, sharing, migration |

### 9.2 Migration path

Over time, the "Create Agent" primary button on `/admin/agents` should route to the builder wizard instead of the quick-create form. The quick-create form becomes an "Advanced: Quick Create" secondary option. This transition happens when the builder wizard is stable and tested.

### 9.3 Shared components

The builder wizard steps should extract and reuse the existing section components where possible:

- `ModelSelect` (already a standalone component)
- Emoji picker (from `NewAgentClient.tsx`, should be extracted to shared)
- Soul editor (CodeMirror setup from `SoulSection.tsx`, should be extracted)
- Network policy preset selector and rule editor (from `NetworkPolicySection.tsx`)

Extracting these into `apps/web/app/admin/components/` or `apps/web/components/` reduces duplication and ensures the builder and detail page stay in sync.

---

## 10. Open Questions

### Resolved

| # | Question | Decision |
|---|----------|----------|
| Q17 | **Test conversation scope** | INCLUDED in v1. Temp agent with `published: false` and random `_test-` handle. See Step 7 (Section 5.2) and tRPC routes (Section 6.2) for full lifecycle details. |
| Q18 | **Soul AI assist vs. presets** | Ship preset personas (Creative, Engineer, Marketer, CEO, First-level Support, Analyst, Community Manager) as static TS constants. No AI generation in v1. See Step 2 (Section 5.2). |
| Q19 | **Cross-instance sharing** | CORE v1 feature. The `.nitejar-agent.json` format is the sharing protocol. No bundled templates; no registry. See Section 8. |
| Q22 | **Profile format versioning** | Zod schema validation on import (`.passthrough()` for unknown fields). v2 importers MUST be able to read v1 files. See Section 4.2. |
| Q8/Q23 | **Test agent cleanup** | Both: (a) immediate cleanup on wizard close via `beforeunload` + route change, AND (b) background sweep every 30 minutes that purges `_test-` agents older than 1 hour. See Step 7 (Section 5.2). |
| Q10 | **Model compatibility** | Yes, import warns when the model's provider has no API key configured. Covered in Section 8.2 dependency handling table. |

### Deferred to post-v1

| # | Question | Notes |
|---|----------|-------|
| Q20 | **Seed memories on export** | Leave as opt-in flag (`includeSeedMemories`). Default behavior (on vs. off) deferred -- current spec keeps it off by default. |
| Q21 | **Routine export** | Deferred. Routines reference plugin instance IDs and session keys, making them non-portable. Revisit when a `routineTemplates` sanitization strategy is designed. |
| Q24 | **Wizard state persistence** | Deferred. Wizard state is lost on navigation away (current behavior). localStorage persistence is a post-v1 UX improvement. |
| Q26 | **Profile signing** | Deferred. Relevant for the community gallery (future). No signing infrastructure in v1. |

### Remaining open

2. **Soul AI assist (future):** Should a future version offer "generate soul from description" where the operator types a plain-language description and an LLM generates a soul document draft? Deferred from v1 in favor of presets, but high-value for a future iteration.

---

## Appendix A: Existing Agent Config Shape

For reference, the current `AgentConfig` type from `packages/agent/src/types.ts`:

```typescript
interface AgentConfig {
  systemPrompt?: string          // Legacy, deprecated
  model?: string                 // Model external ID
  temperature?: number           // 0.0 - 2.0
  maxTokens?: number             // Max response tokens
  editToolMode?: EditToolMode    // 'hashline' | 'replace'
  title?: string                 // Role/title
  emoji?: string                 // Avatar emoji
  avatarUrl?: string             // Avatar URL
  soul?: string                  // Markdown personality doc
  memorySettings?: MemorySettings
  sessionSettings?: SessionSettings
  networkPolicy?: NetworkPolicy
  allowEphemeralSandboxCreation?: boolean
  allowRoutineManagement?: boolean
  queue?: AgentQueueConfig
  triageSettings?: TriageSettings
}
```

The `AgentTable` stores this as a JSON string in the `config` column. The profile format (Section 2.1) is a superset that adds identity fields (from the agent row itself), cost limits (from `cost_limits` table), plugin requirements (from `agent_plugin_instances` join), and seed memories (from `agent_memories` table).

## Appendix B: Relevant Source Files

| File | What it contains |
|------|-----------------|
| `packages/database/src/types.ts` | All DB table types including `AgentTable`, `AgentMemoryTable`, `CostLimitTable`, `AgentPluginInstanceTable` |
| `packages/database/src/repositories/agents.ts` | Agent CRUD (create, update, delete, find) |
| `packages/database/src/repositories/memories.ts` | Memory CRUD, decay, similarity search |
| `packages/database/src/repositories/cost-limits.ts` | Cost limit CRUD and enforcement |
| `packages/database/src/repositories/plugin-instances.ts` | Plugin instance CRUD, agent assignments |
| `packages/agent/src/types.ts` | `AgentConfig`, `NetworkPolicy`, `MemorySettings`, `SessionSettings`, etc. |
| `packages/agent/src/config.ts` | Config parsing, validation, defaults, merge |
| `packages/agent/src/network-policy.ts` | Policy presets, validation, DEFAULT_NETWORK_POLICY |
| `packages/agent/src/prompt-builder.ts` | System prompt assembly from config |
| `packages/agent/src/tools/definitions.ts` | Tool catalog (all available tools) |
| `packages/agent/src/tools/handlers/index.ts` | Tool handler registry |
| `packages/agent/src/runner.ts` | Agent inference loop |
| `apps/web/server/routers/org.ts` | Agent create/update/list tRPC routes |
| `apps/web/server/routers/_app.ts` | Router composition |
| `apps/web/app/admin/agents/new/NewAgentClient.tsx` | Current create form |
| `apps/web/app/admin/agents/[id]/page.tsx` | Current agent detail page |
| `apps/web/app/admin/agents/[id]/SoulSection.tsx` | Soul editor component |
| `apps/web/app/admin/agents/[id]/ModelSection.tsx` | Model config component |
| `apps/web/app/admin/agents/[id]/NetworkPolicySection.tsx` | Network policy component |
| `apps/web/app/admin/agents/[id]/CostSection.tsx` | Cost limits component |
| `apps/web/app/admin/plugins/install/PluginInstallWizard.tsx` | Plugin install wizard (UX pattern reference) |
| `apps/web/lib/soul-presets.ts` | Soul preset constants (new, Step 2 of wizard) |
| `apps/web/server/routers/agent-builder.ts` | Test conversation & temp agent tRPC routes (new) |
| `apps/web/server/services/agent-builder-cleanup.ts` | Background sweep for orphaned temp agents (new) |
