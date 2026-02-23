# Nitejar Product Requirements Document

## Overview

Nitejar is a multi-agent system for running AI agents that respond to messages from various integrations (Telegram, GitHub, Slack) and execute code/commands on persistent Sprite environments.

---

## Product Principles

- **Durable agent identities** by default (persistent "home" state, tools/skills, caches, preferences, memory)
- **Ephemeral workflows** as a first-class primitive (disposable workspaces/runs; reproducible execution)
- **Extensible like Moltbot/Clawdbot** (skills/plugins, tool routing, multiple agents/subagents)
- **Open-core with easy self-hosting** (Dockerfile runs anywhere; opinionated defaults)
- **Hosted SaaS option** (multi-tenant control plane + managed runners)
- **Dogfood self-improvement**: once MVP is stable, Nitejar should be able to help build subsequent features

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Web Server (Docker, runs anywhere) — "The Company"         │
│  - Webhooks from integrations (Telegram, GitHub, Slack...)  │
│  - Admin UI (Next.js)                                       │
│  - Agent inference loop (Claude API calls) — "The Brain"    │
│  - Tool router → sprite exec for execution                  │
│  - Database: SQLite (simple) / Postgres (standard)          │
└─────────────────────────────────────────────────────────────┘
                          │
              sprite exec (sync command/response)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Sprite (per agent) — "The MacBook"                         │
│  - Executes CLI commands, file operations                   │
│  - Persistent filesystem (tools, repos, caches)             │
│  - Git worktrees for parallel work                          │
│  - Dumb executor — no agent logic                           │
│  - Wakes on demand, idles when done                         │
└─────────────────────────────────────────────────────────────┘
```

**Mental model:**

- Web server = the company (infrastructure, comms, HR systems)
- Agent = an employee (identity, role, memory, skills)
- Sprite = employee's MacBook (persistent work environment)
- Inference loop = employee's brain (thinking, deciding)
- Tools = hands on keyboard (how brain interacts with MacBook)

**Key insight:** Inference runs on the web server. Tool execution happens on Sprites via `sprite exec`. Sprites are dumb executors with persistent filesystems. Agent "soul" (memory, preferences) lives in the database where humans can see and configure it.

---

## M0 — Baseline (DONE)

**Goal:** Local harness + GitHub connector + persistence stubs.

**Completed:**

- Manual work-item API + inbox UI
- GitHub webhook replay harness
- GitHub webhook ack comment (when auth configured)
- Postgres store + idempotency keys

---

## M1 — Foundational Platform (Implementation Complete - Testing Required)

**Goal:** Core infrastructure for multi-agent system with integrations, execution, and admin UI.

**Status:** All 8 implementation phases complete. Pending end-to-end testing.

### Architecture Decisions Made

| Decision               | Choice                                                      | Rationale                                                                        |
| ---------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Agent model            | Multi-agent from day 1, pub/sub routing                     | Agents are durable identities like team members; they see work and decide to act |
| Communication protocol | `sprite exec` (sync command/response)                       | Simple, Sprite is dumb executor, inference runs on web server                    |
| Job storage            | Separate `jobs` table                                       | Track multiple runs/agents per work item, retry history                          |
| Coordination           | No locks, social coordination                               | Agents are like humans — they decide, not the system                             |
| Message storage        | Append-only `messages` table, JSONB content                 | Flexible, atomic inserts, AI SDK compatible                                      |
| Streaming              | In-memory buffer + DB replay (Redis for HA)                 | Simple deploys don't need Redis                                                  |
| Database               | Tiered: SQLite (simple) / Postgres (standard) / +Redis (HA) | Cheapest path to start                                                           |
| Deployment             | Dockerfile (universal)                                      | Run anywhere: Fly, DO, Railway, VPS, K8s                                         |
| Integrations           | First-class entities, multiple types/instances              | Extensible to any platform                                                       |
| First integration      | Telegram, then GitHub                                       | Faster feedback loop                                                             |
| Secrets                | Master key encryption (AES-256-GCM)                         | Simple, secure enough for MVP                                                    |
| Admin UI               | Built-in Next.js dashboard                                  | Manage integrations, agents, work items                                          |

### Technical Decisions

**Q1: Agent/Sprite model**

- Multiple Agents per installation supported from day 1
- Agents = Sprites = durable identities with persistent filesystem, memory, soul
- Work items are broadcast; agents decide if they should act (like humans on a team)
- Agent "claims" work item before processing (prevents duplicates)
- Destruction: rarely/never — Sprites idle for free, durability is the point

**Q2: Communication protocol**

- `sprite exec` — synchronous command/response
- Web server runs the inference loop (Claude API calls)
- When agent needs to execute a tool → `sprite exec <command>`
- Sprite executes, returns stdout/stderr, web server continues
- State (memory, tasks, etc.) lives in Postgres on web server

**Q3: Sprite addressability**

- Use Sprites JavaScript SDK (`sprites-js`)
- Auth via Bearer token (`SPRITE_TOKEN` env var)
- Exec API (WebSocket-based) for running commands
- Filesystem API for direct file read/write
- Checkpoints API for snapshot/restore if needed
- SDK: https://github.com/superfly/sprites-js

**Q4: Job table**

- Separate `jobs` table
- Multiple jobs per work item allowed (different agents, retries, collaboration)
- No locking — agents decide whether to work on something, not the system
- Schema: `jobs(id, work_item_id, agent_id, status, started_at, completed_at, error_text)`

**Q5: Agent/Sprite mapping**

- `agents` table with sprite_id
- Agent names unique per deployment (add tenant scope for SaaS later)
- Sprite provisioned via Sprites API when agent is created
- Schema: `agents(id, name UNIQUE, sprite_id, installation_id, config JSONB, created_at, updated_at)`

**Q6: Coordination strategy**

- No system-level locks
- Agents are like humans — they operate independently and decide what to do
- Multiple agents CAN work on the same thing (collaboration is allowed)
- System provides visibility, not constraints

**Q7: Log/message storage**

- Postgres, append-only `messages` table
- Store full UIMessage as JSONB (flexible, no schema migrations for new part types)
- Each message is its own row (atomic inserts)
- Schema: `messages(id, job_id, role, content JSONB, created_at)`
- Index on `(job_id, created_at)` for ordered retrieval

**Q8: Progress streaming**

- SSE from web server, tiered approach
- Simple/Standard: In-memory buffer + DB replay on reconnect (no Redis needed)
- HA mode: Add Redis Streams for shared pub/sub across instances
- On reconnect: client sends last message ID → server queries DB → replays

**Q9: Database/deployment**

- Dockerfile is the universal deploy path
- Simple: SQLite (bundled in container, volume for persistence)
- Standard: External Postgres (any provider)
- HA: Postgres + Redis

**Q10: GitHub authentication**

- GitHub App
- It's the proper pattern and setup isn't hard

**Q11: Integration model**

- Integrations as first-class entities
- Multiple integration types: Telegram, GitHub, Slack, Discord, etc.
- Multiple instances per type allowed (e.g., multiple GitHub Apps)
- Scope: global (all agents see) or scoped (specific agents)
- Schema: `integrations(id, type, name, config JSONB, scope)`

**Q12: First integration**

- Telegram first, then GitHub
- Telegram is simpler: @BotFather setup, simple webhook, fast feedback

**Q13: Secret storage**

- Master key encryption
- Master encryption key in env var (`ENCRYPTION_KEY`)
- Sensitive fields in integration config encrypted in DB (AES-256-GCM)
- Format: `"enc:base64ciphertext"` for encrypted values

**Q14: Admin UI scope**

- Built-in web dashboard (Next.js)
- Integrations: create, configure, list, test webhook
- Agents: create, view status, assign to integrations
- Work items: list, filter by integration/agent, view details
- Jobs/Messages: view inference history, logs, streaming

### Implementation Phases (All Complete)

**Phase 1: Data Model & Schema** [DONE]

- Created `integrations` table (type, name, config JSONB, scope)
- Created `agents` table (name, sprite_id, config)
- Created `agent_integrations` join table
- Updated `work_items` to reference integration
- Created `jobs` table (work_item_id, agent_id, status, timestamps)
- Created `messages` table (job_id, role, content JSONB)
- Added encryption helper for sensitive config fields
- Migration scripts for SQLite and Postgres

**Phase 2: Integrations Framework** [DONE]

- Integration base interface (webhook handler, response poster)
- Integration registry (load by type)
- Webhook router (route incoming webhooks to correct integration)
- Config encryption/decryption on read/write

**Phase 3: Telegram Integration** [DONE - needs E2E test]

- Telegram webhook handler (parse updates)
- Telegram response poster (send messages)
- Document @BotFather setup (at docs/integrations/telegram.md)

**Phase 4: Sprites Integration** [DONE]

- Added Sprites JS SDK
- Sprite provisioning (create when agent created)
- `sprite exec` wrapper for tool execution
- Filesystem operations via Sprites API
- Handle Sprite wake-from-idle

**Phase 5: Agent Inference Loop** [DONE]

- Agent runner (picks up work items, runs inference)
- Tool router (maps tool calls to Sprite exec)
- Message persistence (append to messages table)
- SSE streaming with in-memory buffer
- Job status updates (RUNNING → COMPLETED/FAILED)

**Phase 6: Admin Dashboard** [DONE]

- Integrations UI: list, create, configure, test
- Agents UI: list, create, view status
- Work items UI: list, filter, view details
- Jobs UI: view history, messages, logs
- Live streaming view for active jobs

**Phase 7: GitHub Integration** [DONE - needs E2E test]

- GitHub App webhook handler
- GitHub response poster (issue comments)
- Handle GitHub-specific payload parsing
- Document GitHub App setup (at docs/integrations/github.md)

**Phase 8: Deployment** [DONE - needs fresh deploy test]

- Dockerfile (server + SQLite)
- Volume configuration for SQLite persistence
- Environment variable documentation
- Fly.io deployment guide
- Generic Docker deployment guide

### WebSocket Session Management (Implemented 2026-02-01)

- New `sprite_sessions` table tracks WebSocket sessions per job
- `SpriteSessionManager` creates/reuses sessions within a job
- Shell state (cd, env vars) persists across commands in same job
- Sessions cleaned up when job completes
- Cleanup endpoint at `/api/jobs/cleanup` for orphaned sessions

### Remaining M1 Tasks (Testing)

1. **Test end-to-end Telegram flow**: Send a Telegram message → verify webhook received → work item created → job created → agent inference runs → Sprite executes tools → response posted back to Telegram chat

2. **Test end-to-end GitHub flow**: Create GitHub issue/comment → verify webhook received → work item created → job created → agent inference runs → Sprite executes tools → response posted as GitHub comment

3. **Test fresh Docker deployment**: Deploy to Fly.io from scratch following the docs → verify app starts → create integration → create agent → test E2E flow

4. **Verify multiple agents can exist**: Create 2+ agents → verify both appear in admin UI → verify both can receive work items

5. **Verify Sprite tool execution**: Confirm agent can run bash commands on Sprite → confirm file read/write works → confirm results returned correctly

6. **Verify SSE streaming works**: Open admin UI job view → trigger a job → verify live streaming shows inference progress

7. **Verify secrets encryption**: Create integration with sensitive config → verify encrypted in database → verify decrypted on read

8. **Verify idempotent webhooks**: Send same webhook twice → verify only one work item created

### M1 Exit Criteria Checklist

- [ ] Telegram message → work item → agent response (end-to-end)
- [ ] GitHub comment → work item → agent response (end-to-end)
- [ ] Multiple agents can exist and see work items
- [ ] Agent runs tools on Sprite via `sprite exec`
- [ ] Agent state persists across restarts (Sprite filesystem)
- [ ] Admin dashboard: manage integrations, agents, view work items
- [ ] SSE streaming shows live inference progress
- [ ] Secrets encrypted in database
- [ ] Fresh Docker deploy works following docs
- [ ] Idempotent webhook handling (no duplicate work items)

### Future Enhancements (Documented TODOs)

**TODO: Agent Model Configuration**

- Default model for agents should be in agent's config, not just global env var
- Allows different agents to use different models (cheap vs capable)
- Per-agent model overrides without redeploying
- Cost optimization (use cheap models for simple tasks)
- Current: `AGENT_MODEL` env var or hardcoded default
- Future: `agent.config.model` with fallback to env var

**TODO: Enhanced Agent Tools**
Current tools (bash, read_file, write_file, list_directory, create_directory) are basic. Enhancements:

1. Line numbers in file reads - Helps agent reference specific locations
2. Output truncation with limits - Prevent context overflow on large files
3. Glob/pattern search - Find files by pattern (like Claude Code's Glob tool)
4. Content search (grep) - Search file contents with regex support
5. Smart diffs for edits - Show what changed after write operations

---

## M2 — Agent Soul

**Goal:** Make agents configurable and persistent with memory.

### Scope

- **Memory system** — what agent remembers across sessions
- **Learnings** — patterns, preferences discovered over time
- **Personality/behavior** — human-configurable via admin UI
- **Context** — relevant history surfaced to agent during inference
- **Admin UI** — view and edit agent soul

### Features to Implement

1. **Memory system**: Implement persistent memory that survives across sessions. Agent should remember past conversations, user context, project details. Store in database with efficient retrieval. Consider: conversation summaries vs raw history, memory importance scoring, memory decay/cleanup.

2. **Learnings storage**: Track synthesized insights the agent has learned over time. Different from raw memory - these are patterns like "user prefers TypeScript" or "this repo uses pnpm". Learnings inform future behavior.

3. **Personality/behavior configuration**: Allow humans to configure agent personality via admin UI. Settings: tone (professional/casual), verbosity (terse/detailed), areas of expertise, constraints/rules, system prompt customization.

4. **Context retrieval during inference**: When agent starts processing a work item, surface relevant historical context. Options: semantic search, keyword matching, recency weighting. Include relevant memories and learnings in system prompt.

5. **Admin UI for agent soul**: Add pages to view/edit agent memory, learnings, and personality. List memories with search/filter. Edit/delete memories. Configure personality settings. Preview system prompt.

### Exit Criteria

- [ ] Agent remembers context from previous conversations
- [ ] Humans can view/edit agent memory and preferences via admin UI
- [ ] Agent behavior adapts based on configured personality

---

## M3 — Workflows

**Goal:** Multi-step structured processes for complex tasks.

### Scope

- **Workflow primitives** — define multi-step flows
- **Issue → PR flow** — clone, branch, fix, test, PR
- **Progress updates** — post status back to integration (GitHub comments, Telegram messages)
- **Verification** — run tests/lint, include results
- **Rollback** — handle failures gracefully

### Features to Implement

1. **Workflow primitives**: Define system for multi-step flows. Workflows have: steps (ordered), branching (conditional paths), wait points (external input), state (data passed between steps), error handling. Consider: YAML definition vs code vs UI builder.

2. **Issue-to-PR workflow (flagship)**: End-to-end flow:
   - Receive issue describing bug/feature
   - Clone repository to Sprite
   - Create feature branch
   - Implement fix/feature
   - Run tests locally
   - Create PR with description
   - Link PR to issue
   - Post progress updates throughout

3. **Progress updates**: Post status to source integration during workflow:
   - GitHub: comments on issue showing progress
   - Telegram: messages with status updates
   - Include: current step, completion %, any errors
   - Consider: rate limiting to avoid spam

4. **Verification steps**: Run tests/lint as workflow verification:
   - Execute test suite
   - Run linter
   - Include results in PR description
   - Fail workflow if tests fail (configurable)
   - Support custom verification commands

5. **Rollback handling**: Handle failures gracefully:
   - Track changes made at each step
   - Provide retry option for failed steps
   - Rollback partial changes on failure
   - Clean up branches/files on abort
   - Notify user of failure with context

### Exit Criteria

- [ ] From an issue: agent creates a PR that passes tests
- [ ] Progress visible in source integration
- [ ] Failed steps can be retried or rolled back

---

## M4 — Extensibility

**Goal:** Skills, routing, and subagents for specialized work.

### Scope

- **Skill manifest + registry** — package/bundle with entrypoints, required tools
- **Enable/disable per org/repo/agent**
- **Multi-agent routing** — route work to specialized agents (coder, reviewer, ops)
- **Subagents** — spawn child agents for parallel tasks
- **Execution continuity model** — session-owned long-lived tasks with run-level receipts
- **Tool permission profiles** — read-only vs PR-writer vs ops

### Features to Implement

1. **Skill manifest and registry**: Define skill package format:
   - manifest.json: name, version, description, entrypoints
   - Required tools/permissions
   - Configuration schema
   - Implement registry to list/search/enable skills
   - Consider: git repo vs npm package vs URL bundle

2. **Per-scope skill enablement**: Enable/disable skills at different levels:
   - Global (all agents)
   - Per organization
   - Per repository
   - Per agent
   - Inheritance: agent inherits org settings, can override

3. **Multi-agent routing**: Route work items to specialized agents:
   - Coder agent: writes code
   - Reviewer agent: reviews PRs
   - Ops agent: handles deployments
   - Routing logic: content analysis, explicit commands, rules
   - Agent can suggest re-routing if wrong fit

4. **Subagent spawning**: Allow agents to spawn children:
   - Parent delegates specific subtask
   - Child works in isolation
   - Results returned to parent
   - Use case: parallel research, code + tests, multiple files
   - Resource limits to prevent runaway spawning

5. **Execution ownership and continuation**: Unify lifecycle rules for:
   - Background tasks
   - Subagent child runs
   - Agent collaboration handoffs/relays
   - Owner identity (`session_key`, `agent_id`, optional sandbox) controls cross-run management
   - Creator identity (`work_item`, `dispatch`, `job`) preserves receipts/audit lineage
   - Parent/child links are explicit for activity nesting and continuation, not only source-ref heuristics

6. **Tool permission profiles**: Define permission levels:
   - read-only: can read files, no writes
   - PR-writer: can create branches, PRs
   - full-ops: can deploy, run any command
   - Assign profiles to agents
   - Tools check permissions before executing

### Exit Criteria

- [ ] Add a skill and see new commands available
- [ ] Work routed to appropriate specialized agent
- [ ] Subagents can work in parallel
- [ ] Background tasks can continue across runs with owner-scoped controls
- [ ] Child subagent runs are continuable and manageable from later runs
- [ ] Agent collaboration nesting is backed by explicit parent links

---

## M5 — Notifications

**Goal:** Smart notification system that replaces GitHub notifications.

### Scope

- **Notification rules** — per user/team: digest, escalations, approvals
- **Channels** — email + Slack (initial)
- **Subscriptions** — follow work items, repos, labels
- **Digest** — summarized updates on schedule

### Features to Implement

1. **Notification rules engine**: Define rules per user/team:
   - Triggers: work item created, job completed, error occurred, approval needed
   - Actions: immediate notify, add to digest, escalate
   - Conditions: repo, label, priority, time of day
   - UI to manage rules

2. **Multi-channel delivery**: Support multiple channels:
   - Email (initial): basic email delivery
   - Slack (initial): webhook or app integration
   - Future: Discord, Teams, SMS
   - Per-user channel preferences

3. **Subscriptions**: Users can follow entities:
   - Work items: get updates on specific items
   - Repositories: all activity in repo
   - Labels: items with specific labels
   - Agents: all activity from an agent
   - Manage subscriptions in UI

4. **Digest aggregation**: Summarize updates on schedule:
   - Daily digest: summary of yesterday
   - Weekly digest: summary of week
   - Group by repo/agent/priority
   - Include: completed items, errors, pending approvals
   - Configurable schedule per user

### Exit Criteria

- [ ] Users rely on Nitejar notifications over GitHub notifications
- [ ] Configurable notification preferences per user

---

## M6 — SaaS (Closed Source)

**Goal:** Multi-tenant hosted version for paying customers.

### Scope (Closed Source)

- Multi-tenant RBAC, org management
- Billing, quotas
- Managed Sprites
- Advanced audit retention, SSO

### Open-Core Boundary

**Stays open source:**

- Single-tenant self-host deploy
- Core APIs, schemas
- Runner interfaces
- Skill framework

**SaaS-only (closed source):**

- Multi-tenant architecture
- Billing and quotas
- Managed Sprite infrastructure
- Enterprise features (SSO, audit, etc.)

### Features to Implement (Closed Source)

1. **Multi-tenant architecture**: Tenant isolation, RBAC, org management. Each tenant sees only their data. Tenant-scoped everything.

2. **Billing and quotas**: Usage-based billing. Quota enforcement. Plan tiers (free/pro/enterprise). Stripe integration.

3. **Managed Sprites**: Provision and manage Sprites for customers. Handle scaling up/down. Cleanup idle Sprites. Per-tenant resource limits.

4. **Enterprise features**: Advanced audit logging with retention. SSO/SAML integration. Custom data retention policies. SLA guarantees.

### Exit Criteria

- [ ] Hosted tenant can connect GitHub org and run agents
- [ ] Billing works correctly
- [ ] Tenant isolation verified

---

## Critical Design Decisions (To Be Made)

1. **Identity mapping**: per org, per repo, per user, or configurable? How do we map external identities (GitHub users, Telegram users) to Nitejar concepts?

2. **Sprite provisioning**: When exactly is a Sprite created? On agent creation? On first job? Idle indefinitely or cleanup after timeout?

3. **Skill format**: git repo vs npm package vs URL bundle vs inline definition? How are skills versioned and updated?

4. **Policy model**: What actions require human approvals by default? PRs? Deployments? Cost thresholds?

5. **Open-core boundary**: Final determination of what functionality stays public vs SaaS-only. Need clear guidelines.

---

## Self-Building Loop

**Enable once M1–M3 are stable:**

- Nitejar can open PRs on its own repo
- Add a "nitejar-dev" identity allowed to modify only `nitejar/nitejar`
- Require CI pass + optional human approval to merge

**Initial self-building tasks:**

- Improve docs
- Add fixtures/tests
- Implement small features
- Refactor safely

---

## Historical Context (Session Log)

| Date       | Session            | Summary                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-01-31 | Initial            | Created milestone tracking structure. M1 open questions documented.                                                                                                                                                                                                                                     |
| 2026-01-31 | Architecture       | **Major pivot:** Abandoned Vercel due to serverless timeout constraints. New architecture: Fly.io (web server) + Sprites (execution). Key insight: can't classify tools as fast/slow, ALL execution must be unbounded.                                                                                  |
| 2026-01-31 | M1 Planning        | Answered all 10 open questions. Key decisions: (1) Multi-agent from day 1, pub/sub routing (2) Inference on web server, `sprite exec` for tools (3) Sprites JS SDK (4) No locks, social coordination (5) Tiered DB: SQLite→Postgres→+Redis (6) SSE streaming with in-memory buffer (7) GitHub App auth. |
| 2026-01-31 | M1 Expansion       | Expanded M1 scope: (1) Integrations as first-class entities (Telegram first, then GitHub) (2) Master key encryption for secrets (3) Built-in admin dashboard. Renamed M1 to "Foundational Platform."                                                                                                    |
| 2026-01-31 | Roadmap Rewrite    | Consolidated milestones to remove overlap. New structure: M1=Basic responses, M2=Agent Soul, M3=Workflows, M4=Extensibility, M5=Notifications, M6=SaaS.                                                                                                                                                 |
| 2026-01-31 | M1 Implementation  | Full M1 implementation: Kysely ORM schema, Integrations framework, Sprites SDK wrapper, Agent inference loop, Telegram/GitHub integrations, Admin dashboard, Dockerfile/Fly.io config. All phases complete.                                                                                             |
| 2026-01-31 | M1 Polish          | Fixed job detail page import. Created integration documentation. Fixed build errors. Build passes.                                                                                                                                                                                                      |
| 2026-02-01 | WebSocket Sessions | Implemented session-based Sprite execution: `sprite_sessions` table, `SpriteSessionManager`. Sessions persist shell state across commands within a job.                                                                                                                                                 |
