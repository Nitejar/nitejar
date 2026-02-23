# Outcome Tracking & Agent Journal

**Goal:** Give agents a durable record of what they did, what they expected to happen, and what actually happened — regardless of integration or task type.

**Dependencies:** Session/work item pipeline (exists), agent tool system (exists). Enhanced by agent scheduling (for deferred checks) but not dependent on it.

## Problem

Agents operate in a fire-and-forget loop. They receive work, do things, and exit. There's no record of:
- What the agent was *trying* to accomplish (intent)
- Whether it actually worked (outcome)
- What feedback came back later (signals)
- What the agent should do differently next time (learnings)

This is true regardless of what the agent is doing — writing code, sending emails, updating a CRM, posting messages. Without a feedback loop, the agent can't improve and humans can't audit whether it's actually effective.

## Core Abstraction

Every meaningful agent action follows this lifecycle:

```
Intent → Actions → Immediate Result → [Expectations] → [Signals] → Assessment
```

A **journal entry** captures this lifecycle for a single unit of work. Entries start open and close when enough signals arrive (or enough time passes).

## Features

### 1. Journal Entries

**What it does:** A structured log of agent intent, actions, and outcomes.

**Data model:**

```sql
CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id),          -- which job created this entry
  agent_id TEXT NOT NULL REFERENCES agents(id),
  session_key TEXT NOT NULL,                 -- session context
  intent TEXT NOT NULL,                      -- what the agent was trying to do (natural language)
  intent_type TEXT,                           -- optional category: 'code_fix', 'email', 'crm_update', 'deploy', 'research', etc.
  actions TEXT NOT NULL,                     -- JSON array of actions taken (tool calls, results)
  immediate_result TEXT NOT NULL,            -- 'success' | 'failure' | 'partial' | 'unknown'
  immediate_notes TEXT,                      -- agent's own assessment of what happened
  assessment TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'success' | 'failure' | 'partial' | 'expired'
  assessment_notes TEXT,                     -- why the assessment was made
  closed_at INTEGER,                         -- when assessment was finalized
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**Example entries:**

```json
{
  "intent": "Fix ESLint no-control-regex error and open PR",
  "intent_type": "code_fix",
  "actions": [
    { "tool": "write_file", "target": "packages/agent/src/tools.ts", "result": "ok" },
    { "tool": "bash", "command": "git push", "result": "ok" },
    { "tool": "bash", "command": "gh pr create", "result": "PR #3 created" }
  ],
  "immediate_result": "success",
  "immediate_notes": "PR opened, CI running"
}
```

```json
{
  "intent": "Email client project status update",
  "intent_type": "email",
  "actions": [
    { "tool": "send_email", "to": "client@acme.com", "result": "delivered" }
  ],
  "immediate_result": "success",
  "immediate_notes": "Email delivered to client@acme.com"
}
```

```json
{
  "intent": "Update deal stage to Closed Won in HubSpot",
  "intent_type": "crm_update",
  "actions": [
    { "tool": "hubspot_update", "record": "deal_123", "result": "200 OK" }
  ],
  "immediate_result": "success",
  "immediate_notes": null
}
```

### 2. Expectations

**What it does:** The agent registers what it expects to happen after its actions. Expectations are open questions that signals can answer.

```sql
CREATE TABLE journal_expectations (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES journal_entries(id),
  description TEXT NOT NULL,               -- "CI should pass on PR #3"
  status TEXT NOT NULL DEFAULT 'open',     -- 'open' | 'met' | 'unmet' | 'expired'
  match_hint TEXT,                          -- JSON: hints for signal matching (e.g., {"source": "github", "pr": 3})
  expires_at INTEGER,                       -- auto-expire if no signal by this time
  resolved_by TEXT,                         -- signal_id that resolved this expectation
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
```

**Examples:**

| Intent | Expectation | Match hint | Expires |
|---|---|---|---|
| Opened PR #3 | "CI should pass" | `{"source": "github", "event": "check_run", "pr": 3}` | 30 min |
| Emailed client | "Client may reply" | `{"source": "email", "from": "client@acme.com"}` | 48 hours |
| Updated CRM deal | "Manager may have feedback" | `{"source": "telegram", "about": "deal_123"}` | 24 hours |
| Posted deploy | "No incidents reported" | `{"source": "pagerduty"}` | 4 hours |

**Expiry behavior:** When an expectation expires without a signal:
- Positive expectations ("should pass") → `expired` (assessment stays open or goes to `unknown`)
- Negative expectations ("no incidents") → `met` (absence of bad signal = good)

The `match_hint` field is a loose matching guide, not a rigid schema. Signal routing uses it as a hint but can also match on session_key, agent_id, or timing.

### 3. Signals

**What it does:** External events that resolve expectations and update journal assessments.

```sql
CREATE TABLE journal_signals (
  id TEXT PRIMARY KEY,
  entry_id TEXT REFERENCES journal_entries(id),    -- may be null if unmatched
  expectation_id TEXT REFERENCES journal_expectations(id), -- may be null
  source TEXT NOT NULL,                             -- 'github', 'telegram', 'email', 'scheduled_check', 'human', 'system'
  signal_type TEXT NOT NULL,                        -- 'positive', 'negative', 'neutral', 'correction'
  summary TEXT NOT NULL,                            -- human-readable summary
  data TEXT,                                        -- JSON: raw signal data
  created_at INTEGER NOT NULL
);
```

**How signals arrive:**

| Source | Trigger | Example |
|---|---|---|
| GitHub webhook | `check_run`, `pull_request`, `pull_request_review` | CI passed, PR merged, review: changes requested |
| Human message | User reply on same session | "Good job" / "That's wrong, the deal is actually delayed" |
| Scheduled check | Agent's own deferred check fires | Agent checks CI status, finds it passed |
| Heartbeat | Periodic sweep finds relevant info | "PR #3 was merged since last check" |
| Integration callback | Email delivery receipt, CRM webhook | "Email bounced" / "Deal updated by someone else" |
| System | Timeout, error, implicit | Expectation expired with no negative signal |

**Signal routing:** When a signal arrives, the system tries to match it to an open expectation:

1. Check `match_hint` fields on open expectations for the same agent
2. Check session_key overlap (signal on same session as the journal entry)
3. Check temporal proximity (signal arrived within the expectation's expiry window)
4. If no match found, attach to the entry but not to a specific expectation (unstructured signal)
5. If no entry match at all, store as an orphan signal (may be useful later)

### 4. Assessment Lifecycle

Journal entries move through assessment states:

```
open → success    (all expectations met, or positive signals received)
open → failure    (negative signal, or critical expectation unmet)
open → partial    (some expectations met, some not)
open → expired    (all expectations expired, no strong signal either way)
```

**Auto-assessment rules** (configurable per agent):

- All expectations `met` → assessment = `success`
- Any expectation `unmet` with `signal_type = 'negative'` → assessment = `failure`
- Mix of met/unmet → assessment = `partial`
- All expectations expired, no negative signals → assessment = `success` (configurable: could be `expired`)
- Human says "good job" or equivalent → override to `success`
- Human says "that's wrong" or equivalent → override to `failure` with `signal_type = 'correction'`

**Manual override:** Humans can always manually assess a journal entry via admin UI or by replying to the agent.

### 5. Agent Tools

#### `log_intent`

Called at the start of meaningful work. Creates a journal entry.

```typescript
{
  name: 'log_intent',
  description: 'Log what you are about to do and why. Call this before taking significant actions.',
  parameters: {
    intent: { type: 'string', description: 'What you are trying to accomplish', required: true },
    intent_type: { type: 'string', description: 'Category: code_fix, email, crm_update, deploy, research, message, other', required: false },
  }
}
```

Returns a `journal_entry_id` that the agent uses for subsequent calls.

#### `log_outcome`

Called after completing actions. Updates the journal entry with results.

```typescript
{
  name: 'log_outcome',
  description: 'Record the result of your actions and any expectations for follow-up.',
  parameters: {
    entry_id: { type: 'string', required: true },
    result: { type: 'string', description: 'success | failure | partial | unknown', required: true },
    notes: { type: 'string', description: 'What happened, what you observed', required: false },
    expectations: {
      type: 'array',
      items: {
        description: { type: 'string' },
        match_hint: { type: 'object' },
        expires_minutes: { type: 'number' },
      },
      description: 'Things you expect to happen next',
      required: false,
    },
  }
}
```

#### `review_journal`

Look back at past entries — what worked, what didn't.

```typescript
{
  name: 'review_journal',
  description: 'Review your past actions and their outcomes. Use this to learn from experience.',
  parameters: {
    filter: { type: 'string', description: 'all | open | success | failure | partial', required: false },
    intent_type: { type: 'string', description: 'Filter by category', required: false },
    limit: { type: 'number', description: 'Max entries to return (default 10)', required: false },
  }
}
```

### 6. Connecting to Other Systems

**Scheduling integration:**

When the agent calls `log_outcome` with expectations, it can optionally auto-create a `schedule_check` for each expectation. This turns "I expect CI to pass" into "check CI in 5 minutes" automatically. If the scheduling system exists, they compose. If it doesn't exist yet, expectations still work — they just rely on webhooks and human signals rather than agent-initiated polling.

**Heartbeat integration:**

Heartbeat checklist can include "review open journal expectations." On each heartbeat, the agent checks for entries with open expectations that may have been resolved by now. This is how heartbeats close loops.

**Memory/learning integration (future):**

When an entry closes (especially failures or corrections), the system can prompt the agent to extract a learning: "What would you do differently?" This becomes a persistent memory entry that's surfaced in future similar tasks. This is a separate feature but the journal provides the raw material.

**Admin UI:**

- Journal timeline per agent (what it did, what happened)
- Open expectations dashboard (what's the agent waiting on?)
- Assessment summary (success rate over time, by intent_type)
- Signal routing debugger (which signals matched which expectations)

## What the Agent's System Prompt Needs

The agent needs to know about the journal. Add to system prompt:

```
You have a journal for tracking your work. Use it to:
- log_intent before starting significant work
- log_outcome when you finish, with expectations for what should happen next
- review_journal to learn from past experience before starting similar tasks

This helps you improve over time and helps your team trust your work.
Do not log trivial actions (reading a file, listing a directory). Log meaningful units of work — a PR, an email, a deployment, a CRM update, a research finding.
```

## Non-Goals

- Automated learning extraction (future — journal provides raw material, learning layer is separate)
- Trust scoring / progressive autonomy (separate feature, but consumes journal data)
- Token budget tracking (related but separate concern — could be a field on journal entries)
- Integration-specific outcome schemas (journal is deliberately generic)

## Exit Criteria

- [ ] Agent can log intent before taking actions
- [ ] Agent can log outcome with expectations after completing work
- [ ] Expectations can be matched to incoming signals (webhooks, human messages, scheduled checks)
- [ ] Expectations auto-expire based on configured timeouts
- [ ] Journal assessments update as signals arrive
- [ ] Human feedback (positive/negative) overrides assessment
- [ ] Agent can review its own journal to see past outcomes
- [ ] Admin UI shows journal timeline per agent
- [ ] Admin UI shows open expectations
- [ ] Journal works for any task type (code, email, CRM, messaging, etc.)
- [ ] Signal routing handles GitHub webhooks, human messages, and scheduled checks
