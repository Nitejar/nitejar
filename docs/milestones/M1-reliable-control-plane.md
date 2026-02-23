# M1 — Foundational Platform

**Goal:** Core infrastructure for multi-agent system with integrations, execution, and admin UI.

**Status:** Planning complete, ready for implementation

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Web Server (Fly.io) — "The Company"                        │
│  - GitHub webhooks                                          │
│  - UI (Next.js)                                             │
│  - Agent inference loop (Claude API calls) — "The Brain"    │
│  - Tool router → sprite exec for execution                  │
│  - Postgres (state, memory, tasks, jobs)                    │
└─────────────────────────────────────────────────────────────┘
                          │
              sprite exec (sync command/response)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Sprite (per agent) — "The MacBook"                         │
│  - Executes CLI commands, file operations                   │
│  - Persistent filesystem (tools, repos, caches)             │
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

**Key insight:** Inference runs on the web server (Fly.io container = no timeout). Tool execution happens on Sprites via `sprite exec`. Sprites are dumb executors with persistent filesystems.

---

## Open Questions

### Sprites Integration

- [x] **Q1: Agent/Sprite model?**
  - **Decision:** Multiple Agents per installation supported from day 1
  - Agents = Sprites = durable identities with persistent filesystem, memory, soul
  - Work items are broadcast; agents decide if they should act (like humans on a team)
  - Agent "claims" work item before processing (prevents duplicates)
  - Creation mechanism TBD (admin action, config file, or API)
  - Destruction: rarely/never — Sprites idle for free, durability is the point

- [x] **Q2: Communication protocol?**
  - **Decision:** `sprite exec` — synchronous command/response
  - Web server runs the inference loop (Claude API calls)
  - When agent needs to execute a tool → `sprite exec <command>`
  - Sprite executes, returns stdout/stderr, web server continues
  - State (memory, tasks, etc.) lives in Postgres on web server
  - Sprite is a "dumb executor" with persistent filesystem — no agent logic there

  **Mental model:**
  - Web server = the company (infrastructure, comms, task routing)
  - Agent = an employee (identity, role, memory)
  - Sprite = employee's MacBook (persistent work environment)
  - Inference loop = employee's brain
  - Tools = hands on keyboard (how brain interacts with MacBook)

- [x] **Q3: Sprite addressability?**
  - **Decision:** Use Sprites JavaScript SDK (`sprites-js`)
  - Auth via Bearer token (`SPRITE_TOKEN` env var)
  - Exec API (WebSocket-based) for running commands
  - Filesystem API for direct file read/write
  - Checkpoints API for snapshot/restore if needed
  - SDK: https://github.com/superfly/sprites-js

### Data Model

- [x] **Q4: Job table or reuse WorkItem?**
  - **Decision:** Separate `jobs` table
  - Multiple jobs per work item allowed (different agents, retries, collaboration)
  - No locking — agents decide whether to work on something, not the system
  - Agents can see what others are doing and coordinate socially (like humans)
  - Schema: `jobs(id, work_item_id, agent_id, status, started_at, completed_at, error_text)`

- [x] **Q5: How to store Sprite/Agent mapping?**
  - **Decision:** `agents` table with sprite_id
  - Agent names unique per deployment (add tenant scope for SaaS later)
  - Sprite provisioned via Sprites API when agent is created
  - Optional `installation_id` to scope agents to a GitHub org
  - Schema: `agents(id, name UNIQUE, sprite_id, installation_id, config JSONB, created_at, updated_at)`

### Coordination

- [x] **Q6: Locking / coordination strategy?**
  - **Decision:** No system-level locks
  - Agents are like humans — they operate independently and decide what to do
  - Multiple agents CAN work on the same thing (collaboration is allowed)
  - Agents see what others are doing (query jobs) and decide socially
  - System provides visibility, not constraints

### Observability

- [x] **Q7: Log/message storage?**
  - **Decision:** Postgres, append-only `messages` table
  - Store full UIMessage as JSONB (flexible, no schema migrations for new part types)
  - Each message is its own row (atomic inserts, not rewriting whole conversation)
  - Tool calls included in message JSONB (can normalize to separate table later if needed)
  - Schema: `messages(id, job_id, role, content JSONB, created_at)`
  - Index on `(job_id, created_at)` for ordered retrieval

- [x] **Q8: Progress streaming to UI?**
  - **Decision:** SSE from web server, tiered approach
  - **Simple/Standard:** In-memory buffer + DB replay on reconnect (no Redis needed)
  - **HA mode:** Add Redis Streams for shared pub/sub across instances
  - On reconnect: client sends last message ID → server queries DB → replays
  - Keeps simple deploys cheap (single app, no Redis)

### Deployment

- [x] **Q9: Database / deployment?**
  - **Decision:** Dockerfile is the universal deploy path
  - **Simple:** SQLite (bundled in container, volume for persistence)
  - **Standard:** External Postgres (any provider)
  - **HA:** Postgres + Redis
  - Dockerfile works on Fly, DO, Railway, any VPS, Kubernetes
  - Provider-specific docs just explain how to run the container

- [x] **Q10: GitHub auth pattern for MVP docs?**
  - **Decision:** GitHub App
  - It's the proper pattern and setup isn't hard
  - Document GitHub App setup in deployment guide

### Integrations

- [x] **Q11: Integration model?**
  - **Decision:** Integrations as first-class entities
  - Multiple integration types: Telegram, GitHub, Slack, Discord, etc.
  - Multiple instances per type allowed (e.g., multiple GitHub Apps)
  - Scope: global (all agents see) or scoped (specific agents)
  - Schema: `integrations(id, type, name, config JSONB, scope)`
  - Work items reference source integration

- [x] **Q12: First integration?**
  - **Decision:** Telegram first, then GitHub
  - Telegram is simpler: @BotFather setup, simple webhook, fast feedback
  - Proves out integration model before GitHub complexity

### Security

- [x] **Q13: Secret storage?**
  - **Decision:** Master key encryption
  - Master encryption key in env var (`ENCRYPTION_KEY`)
  - Sensitive fields in integration config encrypted in DB (AES-256-GCM)
  - Format: `"enc:base64ciphertext"` for encrypted values
  - Simple decrypt helper checks prefix, decrypts if needed

### Admin Dashboard

- [x] **Q14: Admin UI scope?**
  - **Decision:** Built-in web dashboard (Next.js)
  - **Integrations:** create, configure, list, test webhook
  - **Agents:** create, view status, assign to integrations
  - **Work items:** list, filter by integration/agent, view details
  - **Jobs/Messages:** view inference history, logs, streaming

---

## Design Decisions

_Fill in as decisions are made._

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

---

## Implementation Tasks

### Phase 1: Data Model & Schema

- [x] Create `integrations` table (type, name, config JSONB, scope)
- [x] Create `agents` table (name, sprite_id, config)
- [x] Create `agent_integrations` join table
- [x] Update `work_items` to reference integration
- [x] Create `jobs` table (work_item_id, agent_id, status, timestamps)
- [x] Create `messages` table (job_id, role, content JSONB)
- [x] Add encryption helper for sensitive config fields
- [x] Migration scripts for SQLite and Postgres

### Phase 2: Integrations Framework

- [x] Integration base interface (webhook handler, response poster)
- [x] Integration registry (load by type)
- [x] Webhook router (route incoming webhooks to correct integration)
- [x] Config encryption/decryption on read/write

### Phase 3: Telegram Integration

- [x] Telegram webhook handler (parse updates)
- [x] Telegram response poster (send messages)
- [ ] Test end-to-end: message → work item → response
- [x] Document @BotFather setup

### Phase 4: Sprites Integration

- [x] Add Sprites JS SDK
- [x] Sprite provisioning (create when agent created)
- [x] `sprite exec` wrapper for tool execution
- [x] Filesystem operations via Sprites API
- [x] Handle Sprite wake-from-idle

### Phase 5: Agent Inference Loop

- [x] Agent runner (picks up work items, runs inference)
- [x] Tool router (maps tool calls to Sprite exec)
- [x] Message persistence (append to messages table)
- [x] SSE streaming with in-memory buffer
- [x] Job status updates (RUNNING → COMPLETED/FAILED)

### Phase 6: Admin Dashboard

- [x] Integrations UI: list, create, configure, test
- [x] Agents UI: list, create, view status
- [x] Work items UI: list, filter, view details
- [x] Jobs UI: view history, messages, logs
- [x] Live streaming view for active jobs

### Phase 7: GitHub Integration

- [x] GitHub App webhook handler
- [x] GitHub response poster (issue comments)
- [x] Handle GitHub-specific payload parsing
- [x] Document GitHub App setup

### Phase 8: Deployment

- [x] Dockerfile (server + SQLite)
- [x] Volume configuration for SQLite persistence
- [x] Environment variable documentation
- [x] Fly.io deployment guide
- [x] Generic Docker deployment guide
- [ ] Test fresh deploy from scratch

---

## Exit Criteria Checklist

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

---

## Notes

_Space for implementation notes, learnings, and context for future sessions._

### 2026-01-31: Architecture Decision

Decided to move away from Vercel due to serverless timeout constraints. Key insight: we can't classify tools as "fast" vs "slow" because we don't control what tools exist or how they compound. ALL execution must happen in an unbounded environment.

Chose Fly.io + Sprites:

- Fly.io: runs the web server (webhooks, UI, API)
- Sprites: run agent execution (persistent, hardware-isolated, no timeouts)

### TODO: Agent Model Configuration

**Future enhancement:** The default model for agents should be specified in the agent's config, not just a global env var. This allows:

- Different agents to use different models (cheap vs capable)
- Per-agent model overrides without redeploying
- Cost optimization (use cheap models for simple tasks)

Current: `AGENT_MODEL` env var or hardcoded default
Future: `agent.config.model` with fallback to env var

### TODO: Enhanced Agent Tools

**Future enhancement:** Improve agent file tools with features similar to Claude Code:

Current tools (`bash`, `read_file`, `write_file`, `list_directory`, `create_directory`) are basic. Enhancements:

1. **Line numbers in file reads** - Helps agent reference specific locations
2. **Output truncation with limits** - Prevent context overflow on large files
3. **Glob/pattern search** - Find files by pattern (like Claude Code's Glob tool)
4. **Content search (grep)** - Search file contents with regex support
5. **Smart diffs for edits** - Show what changed after write operations

These make tools more reliable and give the agent better information than raw bash commands, while bash remains available for complex/custom operations.

### 2026-02-01: WebSocket Session Management

Implemented session-based execution for Sprites:

- New `sprite_sessions` table tracks WebSocket sessions per job
- `SpriteSessionManager` creates/reuses sessions within a job
- Shell state (cd, env vars) persists across commands in same job
- Sessions cleaned up when job completes
- Cleanup endpoint at `/api/jobs/cleanup` for orphaned sessions

This enables reliable multi-command workflows where directory changes persist.
