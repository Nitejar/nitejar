# M4 — Extensibility

**Goal:** Skills, routing, and subagents for specialized work.

**Dependencies:** M3 complete (workflows provide foundation for skill execution)

## Overview

M4 makes Nitejar extensible - add new capabilities via skills, route work to specialized agents, and spawn subagents for parallel tasks.
This milestone also defines how long-lived execution survives run boundaries so work remains inspectable and controllable.

## Features

### 1. Skill Manifest and Registry

**What it does:** Define and manage skill packages that add new capabilities.

**Skill manifest format (manifest.json):**

```json
{
  "name": "code-review",
  "version": "1.0.0",
  "description": "Automated code review with best practices",
  "author": "nitejar",
  "entrypoints": {
    "review": {
      "description": "Review a PR or diff",
      "handler": "review.ts",
      "triggers": ["pr_created", "pr_updated"]
    }
  },
  "tools": ["read_file", "bash", "github_comment"],
  "permissions": ["repo:read", "pr:comment"],
  "config": {
    "style_guide_url": {
      "type": "string",
      "description": "URL to style guide",
      "required": false
    }
  }
}
```

**Skill registry:**

- List available skills (built-in + installed)
- Search/filter skills
- Install skills from: git repo, npm package, URL
- Version management
- Dependency resolution

**Implementation:**

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL,
  manifest JSONB NOT NULL,
  source_type TEXT NOT NULL, -- builtin, git, npm, url
  source_url TEXT,
  installed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE skill_installations (
  id TEXT PRIMARY KEY,
  skill_id TEXT REFERENCES skills(id),
  scope_type TEXT NOT NULL, -- global, org, repo, agent
  scope_id TEXT, -- org_id, repo_id, or agent_id
  config JSONB DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  installed_at TIMESTAMP DEFAULT NOW()
);
```

### 2. Per-Scope Skill Enablement

**What it does:** Enable/disable skills at different scope levels.

**Scope hierarchy:**

```
Global (all agents)
  └── Organization
        └── Repository
              └── Agent
```

**Inheritance rules:**

- Lower scopes inherit from higher scopes
- Lower scopes can override (enable/disable)
- Agent-level is most specific

**Example:**

- Global: "code-review" enabled
- Org A: "security-scan" enabled (inherits code-review)
- Repo A1: "code-review" disabled (override)
- Agent A1-dev: "code-review" enabled (override the override)

**Admin UI:**

- Skill management per scope
- Visual inheritance indicator
- Config override per scope

### 3. Multi-Agent Routing

**What it does:** Route work items to specialized agents.

**Agent specializations:**

- **Coder:** Writes and modifies code
- **Reviewer:** Reviews PRs, provides feedback
- **Ops:** Handles deployments, infrastructure
- **Triage:** Categorizes and prioritizes issues
- **Docs:** Writes documentation

**Routing methods:**

1. **Content-based routing:**
   - Analyze work item content
   - Match keywords/patterns to agent expertise
   - ML classifier (future)

2. **Explicit routing:**
   - User mentions specific agent (`@coder fix this`)
   - Label-based (`needs-review` → reviewer)
   - Command-based (`/deploy` → ops)

3. **Rule-based routing:**
   ```json
   {
     "rules": [
       { "if": { "label": "bug" }, "route_to": "coder" },
       { "if": { "type": "pr" }, "route_to": "reviewer" },
       { "if": { "path": "*.md" }, "route_to": "docs" }
     ]
   }
   ```

**Re-routing:**

- Agent can suggest re-routing if work doesn't fit
- "This looks like a docs task, routing to @docs-agent"

**Implementation:**

```sql
CREATE TABLE routing_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  conditions JSONB NOT NULL,
  target_agent_id TEXT REFERENCES agents(id),
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 4. Subagent Spawning

**What it does:** Allow agents to spawn child agents for parallel tasks.

**Use cases:**

- Research task: spawn multiple subagents to search different areas
- Code + Tests: one subagent writes code, another writes tests
- Multi-file changes: parallelize across files
- Review: spawn subagents for different review aspects (security, style, logic)

**Subagent properties:**

- Inherits parent's Sprite (shared filesystem)
- Has own inference context
- Results returned to parent
- Isolated conversation history
- Limited capabilities (can't spawn more subagents by default)

**Implementation:**

```sql
CREATE TABLE subagent_runs (
  id TEXT PRIMARY KEY,
  parent_job_id TEXT REFERENCES jobs(id),
  agent_id TEXT REFERENCES agents(id),
  task TEXT NOT NULL,
  status TEXT NOT NULL, -- pending, running, completed, failed
  result JSONB,
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);
```

**API for parent agent:**

```typescript
// Spawn subagent
const result = await spawnSubagent({
  task: "Search for all usages of AuthService",
  timeout: 60000,
})

// Spawn multiple in parallel
const results = await Promise.all([
  spawnSubagent({ task: "Write unit tests for auth.ts" }),
  spawnSubagent({ task: "Write integration tests for login flow" }),
])
```

**Resource limits:**

- Max concurrent subagents per job
- Max subagent depth (no sub-sub-subagents)
- Timeout per subagent
- Total compute budget

### 5. Execution Ownership and Continuation

**What it does:** Unify lifecycle and receipts for long-lived execution across:

- Background tasks
- Subagent child runs
- Agent collaboration handoffs/relays

**Problem to solve:**

- Run/job-scoped ownership makes long-lived work hard to continue in the next run.
- Nested activity currently relies on source conventions in some flows, not explicit parent links.
- Different mechanisms (background task, child run, relay) behave differently even though users expect the same continuity rules.

**Core model (required):**

- Every long-lived execution record must have:
  - **Owner identity** (who can manage it across runs):
    - `owner_session_key`
    - `owner_agent_id`
    - `owner_sandbox_name` (nullable for non-sandbox work)
  - **Creator identity** (who started it for receipts):
    - `creator_job_id`
    - `creator_dispatch_id`
    - `creator_work_item_id`
- Access control for manage/list/await/cancel operations uses **owner identity**, not creator job.
- Receipts and audit trails preserve creator lineage.

**Background task requirements:**

- Default execution target is active sandbox at start time.
- Optional explicit sandbox override remains available.
- `cleanup_on_run_end=true` remains default.
- If `cleanup_on_run_end=false`, task survives run end and is manageable from later runs with same owner identity.

**Subagent child run requirements:**

- Child runs are first-class records with explicit parent linkage:
  - `parent_work_item_id`
  - `parent_job_id`
  - `parent_dispatch_id`
- Child runs inherit owner identity from parent unless explicitly overridden.
- Parent can list, await, cancel, and summarize open child runs in subsequent runs.

**Agent collaboration requirements:**

- Collaboration work items must use explicit parent links, not only `source_ref` heuristics.
- Public relay flows remain supported, but UI nesting/receipts must be driven by parent links.
- Inter-agent context must include origin + parent linkage so conversation and routing are auditable.

**Carry-over behavior (next run):**

- At run start, load all open owned execution records and inject a concise continuation summary.
- Rebind parent-child relationships on replay/resume so resumed runs can continue managing prior open work.
- Provide explicit cleanup policies:
  - On session reset/close, terminate or archive open owned records.
  - On sandbox deletion, block delete unless open owned tasks are resolved or force-closed with receipts.

**Implementation outline:**

```sql
-- Existing long-lived records gain owner + creator identity.
ALTER TABLE background_tasks ADD COLUMN owner_session_key TEXT NOT NULL;
ALTER TABLE background_tasks ADD COLUMN owner_agent_id TEXT NOT NULL;
ALTER TABLE background_tasks ADD COLUMN owner_sandbox_name TEXT;
ALTER TABLE background_tasks ADD COLUMN creator_dispatch_id TEXT;
ALTER TABLE background_tasks ADD COLUMN creator_work_item_id TEXT;

-- Child run ledger (or equivalent) for subagent execution.
CREATE TABLE run_children (
  id TEXT PRIMARY KEY,
  owner_session_key TEXT NOT NULL,
  owner_agent_id TEXT NOT NULL,
  owner_sandbox_name TEXT,
  parent_work_item_id TEXT REFERENCES work_items(id),
  parent_job_id TEXT REFERENCES jobs(id),
  parent_dispatch_id TEXT REFERENCES run_dispatches(id),
  child_work_item_id TEXT REFERENCES work_items(id),
  child_dispatch_id TEXT REFERENCES run_dispatches(id),
  child_job_id TEXT REFERENCES jobs(id),
  status TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 6. Tool Permission Profiles

**What it does:** Define permission levels limiting agent capabilities.

**Built-in profiles:**

1. **read-only:**
   - `read_file`, `list_directory`, `bash` (read commands only)
   - Cannot modify files or create PRs

2. **contributor:**
   - All read-only permissions
   - `write_file`, `create_directory`
   - Can create branches and PRs
   - Cannot merge or deploy

3. **maintainer:**
   - All contributor permissions
   - Can merge PRs
   - Can modify CI/CD configs

4. **ops:**
   - All permissions
   - Can deploy
   - Can access secrets
   - Can run arbitrary commands

**Custom profiles:**

- Define allowed tools list
- Define allowed commands (bash whitelist/blacklist)
- Define file path restrictions

**Implementation:**

```sql
CREATE TABLE permission_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  permissions JSONB NOT NULL, -- allowed tools, commands, paths
  created_at TIMESTAMP DEFAULT NOW()
);

-- Link to agents
ALTER TABLE agents ADD COLUMN permission_profile_id TEXT REFERENCES permission_profiles(id);
```

**Enforcement:**

- Tool executor checks permissions before running
- Clear error message if blocked
- Audit log of permission denials

## Exit Criteria

- [ ] Skill manifest format defined and documented
- [ ] Skill registry implemented (list, install, uninstall)
- [ ] Skills can be installed from git/npm/URL
- [ ] Per-scope skill enablement works (global/org/repo/agent)
- [ ] Skill inheritance and override works correctly
- [ ] Add a skill and see new commands available
- [ ] Multi-agent routing implemented
- [ ] Work routed to appropriate specialized agent
- [ ] Routing rules configurable via admin UI
- [ ] Subagent spawning implemented
- [ ] Subagents can work in parallel
- [ ] Resource limits enforced for subagents
- [ ] Long-lived execution records use owner + creator identity
- [ ] Background tasks can be continued/managed across runs by owner identity
- [ ] Child subagent runs can be listed/awaited/cancelled in later runs
- [ ] Agent collaboration nesting uses explicit parent links (not only source_ref patterns)
- [ ] Permission profiles defined (read-only, contributor, maintainer, ops)
- [ ] Tool permissions enforced at execution time
- [ ] Permission denials logged for audit
