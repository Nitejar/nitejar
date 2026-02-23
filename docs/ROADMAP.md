# Nitejar Roadmap

> **Detailed milestone tracking:** See [milestones/](./milestones/) for task checklists and open questions.

## Product principles

- **Durable agent identities** by default (persistent "home" state, tools/skills, caches, preferences, memory).
- **Ephemeral workflows** as a first-class primitive (disposable workspaces/runs; reproducible execution).
- **Extensible like Moltbot/Clawdbot** (skills/plugins, tool routing, multiple agents/subagents).
- **Open-core with easy self-hosting** (Dockerfile runs anywhere; opinionated defaults).
- **Hosted SaaS option** (multi-tenant control plane + managed runners).
- **Dogfood self-improvement**: once MVP is stable, Nitejar should be able to help build subsequent features.

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

## Milestones

### M0 — Baseline (done)

**Goal:** Local harness + GitHub connector + persistence stubs.

- Manual work-item API + inbox UI
- GitHub webhook replay harness
- GitHub webhook ack comment (when auth configured)
- Postgres store + idempotency keys

---

### M1 — Foundational Platform

**Goal:** Get basic responses flowing end-to-end.

**Scope:**

- **Integrations framework** — first-class entities, multiple types (Telegram, GitHub, Slack, etc.)
- **Telegram integration** — first integration for fast iteration
- **GitHub integration** — second integration
- **Agents** — multiple agents, each with a Sprite
- **Sprites integration** — JS SDK, provisioning, `sprite exec` for tools
- **Inference loop** — Claude API calls, tool routing, message persistence
- **Admin dashboard** — manage integrations, agents, work items, jobs
- **Streaming** — SSE with in-memory buffer, DB replay on reconnect
- **Secrets** — master key encryption for sensitive config
- **Deployment** — Dockerfile runs anywhere (Fly, DO, Railway, VPS)

**Exit criteria:**

- Telegram message → agent response (end-to-end)
- GitHub comment → agent response (end-to-end)
- Multiple agents can exist
- Agent runs tools on Sprite
- Admin dashboard functional
- Deployable via Docker

---

### M2 — Agent Soul

**Goal:** Make agents configurable and persistent.

**Scope:**

- **Memory system** — what agent remembers across sessions
- **Learnings** — patterns, preferences discovered over time
- **Personality/behavior** — human-configurable via admin UI
- **Context** — relevant history surfaced to agent during inference
- **Admin UI** — view and edit agent soul

**Exit criteria:**

- Agent remembers context from previous conversations
- Humans can view/edit agent memory and preferences
- Agent behavior adapts based on configured personality

---

### M3 — Workflows

**Goal:** Multi-step structured processes.

**Scope:**

- **Workflow primitives** — define multi-step flows
- **Issue → PR flow** — clone, branch, fix, test, PR
- **Progress updates** — post status back to integration (GitHub comments, Telegram messages)
- **Verification** — run tests/lint, include results
- **Rollback** — handle failures gracefully

**Exit criteria:**

- From an issue: agent creates a PR that passes tests
- Progress visible in source integration
- Failed steps can be retried or rolled back

---

### M4 — Extensibility

**Goal:** Skills, routing, and subagents.

**Scope:**

- **Skill manifest + registry** — package/bundle with entrypoints, required tools
- **Enable/disable per org/repo/agent**
- **Multi-agent routing** — route work to specialized agents (coder, reviewer, ops)
- **Subagents** — spawn child agents for parallel tasks
- **Tool permission profiles** — read-only vs PR-writer vs ops

**Exit criteria:**

- Add a skill and see new commands available
- Work routed to appropriate specialized agent
- Subagents can work in parallel

---

### M5 — Notifications

**Goal:** Inbox that doesn't suck.

**Scope:**

- **Notification rules** — per user/team: digest, escalations, approvals
- **Channels** — email + Slack (initial)
- **Subscriptions** — follow work items, repos, labels
- **Digest** — summarized updates on schedule

**Exit criteria:**

- Users rely on Nitejar notifications over GitHub notifications
- Configurable notification preferences

---

### M6 — SaaS

**Goal:** Multi-tenant hosted version.

**Scope (closed source):**

- Multi-tenant RBAC, org management
- Billing, quotas
- Managed Sprites
- Advanced audit retention, SSO

**Open-core remains:**

- Single-tenant self-host deploy
- Core APIs, schemas, runner interfaces, skill framework

**Exit criteria:**

- Hosted tenant can connect GitHub org and run agents

---

## Critical design decisions

1. **Identity mapping**: per org, per repo, per user, or configurable
2. **Sprite provisioning**: create when agent created, idle indefinitely
3. **Skill format**: git repo vs package registry vs bundle
4. **Policy model**: what actions require approvals by default
5. **Open-core boundary**: what stays public vs SaaS-only

---

## Self-building loop

Enable once M1–M3 are stable:

- Nitejar can open PRs on its own repo
- Add a "nitejar-dev" identity allowed to modify only `nitejar/nitejar`
- Require CI pass + optional human approval to merge

**Initial self-building tasks:**

- Improve docs, add fixtures/tests, implement small features, refactor safely
