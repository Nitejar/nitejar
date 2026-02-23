# Agent Scheduling & Heartbeats

**Goal:** Let agents schedule future work, poll for async results, and run periodic heartbeats — all server-side and durable across restarts.

**Dependencies:** Session queue (exists), work item pipeline (exists), agent tool system (exists)

## Problem

Agents are purely reactive today. A webhook arrives, the agent runs, it exits. There's no way for an agent to say "check back on this in 5 minutes" or "wake me up every hour to scan for issues." This means:

- After pushing a CI fix, the agent can't poll for the result — a human has to tell it to check
- No periodic sweeps (stale PRs, unanswered issues, build health)
- No heartbeat-style proactive monitoring
- GitHub CI webhook events (`check_run`, `workflow_run`) aren't wired up, so even instant signals are missed

## Features

### 1. Scheduled Items (Core Primitive)

**What it does:** A database-backed scheduler that promotes items into the session queue when their time comes.

**Data model:**

```sql
CREATE TABLE scheduled_items (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  session_key TEXT NOT NULL,        -- which session to inject into
  type TEXT NOT NULL,               -- 'deferred' | 'heartbeat' | 'cron'
  payload TEXT NOT NULL,            -- JSON: instructions/context for the agent
  run_at INTEGER NOT NULL,          -- unix timestamp for next execution
  recurrence TEXT,                  -- cron expression (null for one-shot)
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'fired' | 'cancelled'
  source_ref TEXT,                  -- optional: links back to a PR, check run, etc.
  created_at INTEGER NOT NULL,
  fired_at INTEGER,
  cancelled_at INTEGER
);

CREATE INDEX idx_scheduled_pending ON scheduled_items(status, run_at)
  WHERE status = 'pending';
```

**Server-side ticker:**

- On startup + every 30 seconds, query: `SELECT * FROM scheduled_items WHERE status = 'pending' AND run_at <= now()`
- For each item:
  - Create a work item on the item's `session_key` with the stored payload
  - Feed it into the session queue (same path as webhook-created work items)
  - Mark as `fired`
  - If `recurrence` is set, compute next `run_at` and insert a new row

**In-memory optimization (optional, later):**

- On item creation, if `run_at` is within the next 10 minutes, also set a `setTimeout`
- If it fires from memory, mark DB row as fired
- If server restarts, the ticker catches anything missed on next sweep

### 2. Agent Schedule Tools

**What it does:** Tools the agent can call to manage its own schedule.

#### `schedule_check`

Create a one-shot deferred run. The agent uses this to say "come back to this later."

```typescript
{
  name: 'schedule_check',
  description: 'Schedule a future check-in on this session. Use this after pushing code to poll CI, or to revisit a task later.',
  parameters: {
    delay_minutes: { type: 'number', description: 'Minutes from now to run (1-1440)', required: true },
    instructions: { type: 'string', description: 'What to check or do when the scheduled time arrives', required: true },
    reference: { type: 'string', description: 'Optional reference (PR URL, check run URL, etc.)', required: false },
  }
}
```

**Example usage by agent:**
```
I've pushed a fix to PR #3. Let me schedule a check to see if CI passes.
→ schedule_check({ delay_minutes: 5, instructions: "Check CI status on PR #3 in nitejar/nitejar. If it passed, report success. If it failed, pull the logs and fix the issue.", reference: "https://github.com/nitejar/nitejar/pull/3" })
```

When the scheduled time arrives, the agent receives a work item like:
```json
{
  "type": "scheduled_check",
  "instructions": "Check CI status on PR #3...",
  "reference": "https://github.com/nitejar/nitejar/pull/3",
  "scheduled_at": "2026-02-10T18:15:00Z",
  "original_context": "You pushed a lint fix to PR #3"
}
```

#### `list_schedule`

View pending scheduled items for this agent/session.

```typescript
{
  name: 'list_schedule',
  description: 'List your pending scheduled checks and heartbeats.',
  parameters: {
    session_only: { type: 'boolean', description: 'Only show items for this session (default: false)', required: false },
  }
}
```

Returns a summary: id, type, run_at, instructions snippet, reference.

#### `cancel_scheduled`

Cancel a pending scheduled item.

```typescript
{
  name: 'cancel_scheduled',
  description: 'Cancel a pending scheduled check or heartbeat.',
  parameters: {
    scheduled_id: { type: 'string', description: 'ID of the scheduled item to cancel', required: true },
  }
}
```

### 3. Heartbeats

**What it does:** Recurring agent turns on a schedule. The agent wakes up, checks a context/checklist, and either acts or stays quiet.

Heartbeats are scheduled items with `type = 'heartbeat'` and a `recurrence` value.

**Configuration — per agent:**

Add to agent config (stored in `agents` table or a new `agent_heartbeat_config` table):

```json
{
  "heartbeat": {
    "enabled": true,
    "interval_minutes": 30,
    "active_hours": { "start": "09:00", "end": "18:00", "timezone": "America/New_York" },
    "checklist": "Check for: (1) open PRs needing review, (2) failed CI on any of my PRs, (3) issues assigned to me with no recent activity.",
    "session_key": "heartbeat:{agent_id}",
    "model_override": null,
    "tool_profile": "heartbeat",
    "max_tokens": 4096,
    "suppress_threshold": 300,
    "on_error": "skip"
  }
}
```

#### Heartbeat configuration fields

| Field | Default | Description |
|---|---|---|
| `enabled` | `false` | Whether heartbeat is active |
| `interval_minutes` | `30` | Minutes between heartbeat runs (15–1440) |
| `active_hours` | `null` (always) | Time window for heartbeats, with timezone |
| `checklist` | `""` | Instructions the agent follows each heartbeat |
| `session_key` | `heartbeat:{agent_id}` | Session to run heartbeats in (see Session Isolation below) |
| `model_override` | `null` (use agent default) | Use a cheaper/faster model for heartbeats (e.g. the free model for routine checks, the good model for complex diagnosis) |
| `tool_profile` | `"heartbeat"` | Which tool permission profile to apply (see Tool Restrictions below) |
| `max_tokens` | `4096` | Max output tokens per heartbeat turn — keeps cost bounded |
| `suppress_threshold` | `300` | Responses under this character count with no actions taken are suppressed (not forwarded to user channels) |
| `on_error` | `"skip"` | What to do when a heartbeat errors: `"skip"` (wait for next), `"retry_once"` (immediate retry then skip), `"disable"` (turn off heartbeat, alert admin) |

#### System prompt injection

Heartbeat turns inject an additional system prompt segment so the agent knows the context:

```
This is a scheduled heartbeat check. You are running autonomously on a timer, not in response to a user message.

Rules:
- Follow your checklist strictly. Do NOT infer or repeat tasks from prior conversations.
- If nothing on the checklist needs attention, respond briefly with what you checked and that everything looks good.
- If something needs attention, take action (if your tools allow it) or alert via the appropriate channel.
- Be concise. This is a check-in, not a conversation.

Your checklist:
{checklist}
```

This is appended to the agent's existing system prompt, not a replacement.

#### Tool restrictions

Heartbeat turns can use a restricted tool profile to limit blast radius:

| Profile | Tools allowed | Use case |
|---|---|---|
| `"heartbeat"` (default) | Read-only: `bash` (read commands), `read_file`, `list_directory`, GitHub API reads, `schedule_check`, `list_schedule`, `cancel_scheduled`, channel messaging (Telegram, GitHub comments) | Safe monitoring — can look at things and report, can't modify code |
| `"heartbeat_active"` | All of `heartbeat` + `write_file`, `create_directory`, git push, PR creation | Agent can autonomously fix things it finds on heartbeat |
| `"full"` | Same as normal agent turn | No restrictions (use with caution) |

The profile is configurable per agent. Default to `"heartbeat"` (read-only) so heartbeats can't accidentally push broken code at 3am.

#### Session isolation

Two modes for where heartbeat turns run:

1. **Dedicated session** (`heartbeat:{agent_id}`) — Default. Clean context each time. Heartbeat doesn't see prior user conversations. Pros: predictable, no context bloat. Cons: no awareness of what the agent was recently working on.

2. **Main session** (same `session_key` as the agent's primary channel) — Heartbeat runs in the agent's conversation context. Pros: agent knows what it was just working on ("I pushed a fix 20 min ago, let me check if CI passed"). Cons: conversation grows, potential context confusion.

Configurable per agent. Dedicated session is safer as default; main session is useful when the heartbeat is tightly coupled to ongoing work.

#### Model selection

The `model_override` field lets you use a different model for heartbeat turns:

- **`null`** — Use the agent's default model. Simplest, but potentially expensive for frequent heartbeats.
- **Cheap model** (e.g. `arcee-ai/trinity-large-preview:free`) — Good for routine "check if anything is on fire" sweeps where the checklist is straightforward.
- **Capable model** — Use when the heartbeat needs to do real analysis (diagnose CI failures, triage issues).

The model is resolved at turn creation time, so it can be changed between heartbeats without affecting in-flight runs.

**Heartbeat flow:**

1. Ticker finds a due heartbeat scheduled item
2. Creates a work item on the heartbeat session with payload:
   ```json
   {
     "type": "heartbeat",
     "checklist": "Check for: (1) open PRs needing review...",
     "heartbeat_id": "hb_abc123",
     "model_override": "arcee-ai/trinity-large-preview:free",
     "tool_profile": "heartbeat",
     "max_tokens": 4096,
     "suppress_threshold": 300
   }
   ```
3. Runner applies the heartbeat system prompt, model override, tool restrictions, and token limit
4. Agent runs, follows checklist
5. If response is under `suppress_threshold` chars and no tool actions were taken → suppressed (logged but not forwarded to channels)
6. If something needs attention → agent takes action or alerts via the appropriate channel (Telegram, GitHub comment, etc.)
7. If agent errors → apply `on_error` policy (skip / retry / disable)
8. Ticker schedules the next heartbeat occurrence

**Agent tool for heartbeat management:**

#### `set_heartbeat`

```typescript
{
  name: 'set_heartbeat',
  description: 'Configure your recurring heartbeat schedule.',
  parameters: {
    enabled: { type: 'boolean', required: true },
    interval_minutes: { type: 'number', description: '15-1440', required: false },
    checklist: { type: 'string', description: 'What to check on each heartbeat', required: false },
    active_hours_start: { type: 'string', description: 'HH:MM start of active window', required: false },
    active_hours_end: { type: 'string', description: 'HH:MM end of active window', required: false },
    timezone: { type: 'string', required: false },
    model_override: { type: 'string', description: 'Model ID for heartbeat turns (null = use agent default)', required: false },
    tool_profile: { type: 'string', description: 'heartbeat | heartbeat_active | full', required: false },
  }
}
```

**Admin UI:**

- View/edit heartbeat config per agent on the agent settings page
- View heartbeat history (when it ran, what it found)
- Enable/disable without deleting config

### 4. GitHub CI Webhook Events

**What it does:** Subscribe to `check_run` and `workflow_run` events so the agent can react instantly to CI results.

**Changes to webhook handler** (`packages/integrations/src/github/webhook.ts`):

Add two new cases to the event switch:

```typescript
case 'check_run':
  return handleCheckRun(payload, deliveryId, config)
case 'workflow_run':
  return handleWorkflowRun(payload, deliveryId, config)
```

#### `handleCheckRun`

- Only process `completed` actions
- Only process `conclusion: 'failure'` or `conclusion: 'timed_out'` (ignore success — no need to wake the agent for green checks)
- **Session key:** derive from the PR (if associated) or branch — so the agent wakes up in the same session that created the PR
- **Payload includes:** check name, conclusion, output summary, logs URL, associated PR number/branch, commit SHA

```typescript
function handleCheckRun(payload, deliveryId, config): WebhookParseResult {
  if (payload.action !== 'completed') return { shouldProcess: false }
  if (payload.check_run.conclusion === 'success') return { shouldProcess: false }

  const pr = payload.check_run.pull_requests?.[0]
  const branch = payload.check_run.head_branch

  return {
    shouldProcess: true,
    workItem: {
      session_key: pr
        ? sessionKeyFromIssue({ owner, repo, issueNumber: pr.number })
        : `github:${owner}/${repo}:branch:${branch}`,
      source: 'github',
      source_ref: `${owner}/${repo}#check_run:${payload.check_run.id}`,
      title: `[${owner}/${repo}] CI failed: ${payload.check_run.name}`,
      payload: JSON.stringify({
        type: 'check_run_failed',
        checkName: payload.check_run.name,
        conclusion: payload.check_run.conclusion,
        outputTitle: payload.check_run.output?.title,
        outputSummary: payload.check_run.output?.summary,
        detailsUrl: payload.check_run.details_url,
        htmlUrl: payload.check_run.html_url,
        branch,
        commitSha: payload.check_run.head_sha,
        prNumber: pr?.number,
        owner,
        repo,
      }),
      status: 'NEW',
    },
    idempotencyKey: `github:${deliveryId}`,
  }
}
```

#### GitHub App permissions update

The manifest (`getManifest` procedure) needs to add for the `robust` preset:

- **Permissions:** `checks: read`, `actions: read`
- **Events:** `check_run`, `workflow_run`

Existing installations will need to accept the updated permissions.

### 5. Composing the Primitives

These features compose naturally:

**Scenario: Agent pushes a fix, monitors CI**
1. Agent pushes code to PR #3
2. Agent calls `schedule_check({ delay_minutes: 7, instructions: "Check CI on PR #3..." })` as a fallback timeout
3. GitHub sends `check_run` webhook when CI finishes (usually 2-3 min)
4. Webhook creates a work item → agent wakes up immediately with the result
5. If the webhook arrived, the deferred check is redundant — agent can `cancel_scheduled` it
6. If the webhook never arrives (misconfigured, GitHub outage), the deferred check fires at minute 7

**Scenario: Heartbeat catches a stale PR**
1. Agent has heartbeat configured: every 30 min, check for stale PRs
2. Heartbeat fires → agent queries GitHub for open PRs with no activity in 24h
3. Agent finds PR #5 has been idle → posts a comment, notifies via Telegram

**Scenario: User asks agent to "check on this tomorrow"**
1. User says "remind me to review this PR tomorrow morning"
2. Agent calls `schedule_check({ delay_minutes: 960, instructions: "Remind user to review PR #7" })`
3. Next morning, ticker fires → agent sends a Telegram message

## Implementation Order

1. **`scheduled_items` table + ticker** — the core primitive everything else builds on
2. **`schedule_check` and `list_schedule` tools** — agent can create and view deferred items
3. **`cancel_scheduled` tool** — agent can clean up
4. **`check_run` webhook handler** — instant CI reaction (independent of scheduling, but composes with it)
5. **Heartbeat config + `set_heartbeat` tool** — recurring scheduled items with admin UI
6. **GitHub App manifest update** — add `checks: read` permission and `check_run` event subscription

## Non-Goals

- Complex DAG-style workflow orchestration (that's M3)
- Multi-agent coordination/routing (that's M4)
- Notification channels and digests (that's M5)
- Persistent job queue with workers (overkill for now — the session queue + ticker is sufficient)
- Sub-second precision scheduling (30-second ticker granularity is fine)

## Exit Criteria

- [ ] Agent can schedule a deferred check and get woken up when it fires
- [ ] Agent can list and cancel its scheduled items
- [ ] Scheduled items survive server restarts (DB-backed)
- [ ] Heartbeat runs on a configurable interval per agent
- [ ] Heartbeat respects active hours
- [ ] Heartbeat suppresses no-op responses (equivalent to HEARTBEAT_OK)
- [ ] `check_run` webhook creates work items on CI failure
- [ ] Agent receives CI failure context in the same session it used to push code
- [ ] Admin UI shows scheduled items and heartbeat config per agent
- [ ] Deferred check + webhook compose (agent can schedule fallback, cancel if webhook arrives first)
