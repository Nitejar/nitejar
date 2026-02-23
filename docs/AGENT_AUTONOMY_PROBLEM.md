# Agent Autonomy Problem Statement

## Problem

Nitejar has strong infrastructure for ingesting incoming work items and producing runs across connected agents.
There is also existing capability for agents to self-determine whether they should respond.

The remaining gap is operational: agents are not yet behaving at the level of sophisticated human workers across noisy, real-world, multi-channel workflows.

In practice, this means interruptions, cross-channel context, and in-progress steering need to be handled with more autonomy and less brittle infrastructure behavior.

## Non-Negotiable Tenants

- Agents are treated like human workers with general autonomy to complete their job.
- Agents make their own decisions. High trust in agent capability is the default.
- Incorrect responses or missing responses are treated as system defects (or prompt-engineering defects) to be fixed.
- Agents must determine on their own what to do with incoming messages while working: ignore, stop, or change direction.
- Agents must communicate with each other through the same integration channels used by humans.
- Agents should maintain awareness of activity across the platform and use that context when deciding whether to steer existing work or ignore new input.

## Local Execution Constraint

- This work is local-only. We prefer completing autonomy/routing improvements in one go (code + tests + eval updates), not staged rollout flags.

## Arbiter Decision Semantics (Normative)

This defines how interruption decisions must behave at runtime.

### Decision values

- `interrupt_now`: Interrupt one or more active runs immediately (this is true steering).
- `do_not_interrupt`: Do not interrupt now; let normal queue/next-run flow handle it.
- `ignore`: Treat as non-actionable noise; do not schedule future work.

### `do_not_interrupt` definition (authoritative)

- `do_not_interrupt` means "not now, but still actionable."
- Message is not injected into active run context.
- Message remains in normal queue processing for the next eligibility window.
- Message is re-evaluated when:
  - target run completes/cancels/fails, or
  - lane is idle and ready to claim next work, or
  - a configured timeout/TTL policy is reached (optional).

### Required state transitions

- `pending` -> `included` when `interrupt_now` is consumed into an active run.
- `pending` -> remains queued for normal dispatch when decision is `do_not_interrupt`.
- `pending` -> `ignored` when decision is `ignore`.

### Why this exists

- Prevents blind mid-run context pollution.
- Prevents "steer forever" loops on pending messages.
- Preserves relevant but non-urgent work without losing intent.

## Steering Mode Clarification

- Steering mode remains an infrastructure capability (interrupt-capable lane behavior).
- Steering mode does **not** imply blind injection.
- Agent-level arbiter decides interruption timing (`interrupt_now`/`do_not_interrupt`/`ignore`); infrastructure enforces the decision.
- `do_not_interrupt` is explicitly **not** steering; it falls back to standard queue/run handling.

## Cross-Lane Injection Contract (Normative)

When an interrupt originates from one lane/channel and targets an active run in another lane/channel, the platform must follow this contract.

### Targeting

- Every interrupt must resolve to explicit target run IDs (or dispatch IDs).
- Never use implicit "other lane" injection.

### Eligibility

- Target run must be `running`.
- Target run must belong to the same agent identity.
- If target is no longer active, downgrade to `do_not_interrupt` and route through normal queue flow.

### Payload shape

- Inject structured interrupt envelopes, not free-form text only.
- Envelope should include:
  - source lane/session/integration
  - source message ID
  - reason/rationale for interruption
  - requested action (if present)
  - preferred reply channel/context

### Idempotency

- Every cross-lane interrupt must carry a unique idempotency key.
- Replays/retries must not inject the same interrupt twice.

### Ordering and coalescing

- Preserve per-target-run interrupt arrival order.
- If many interrupts arrive quickly for the same target run, coalesce in bounded windows before injection.

### Reply channel behavior

- Default user-visible reply path is the source channel/context.
- Cross-post to other channels only when explicitly requested by user intent or tool semantics.

### Visibility (internal UI)

- "Visibility" means inspectability in Nitejar UI, not only chat-output routing.
- Activity page must show cross-lane interrupt decisions and outcomes (`interrupt_now` / `do_not_interrupt` / `ignore`).
- Run detail must show:
  - source message/context
  - target run/dispatch IDs
  - arbiter rationale
  - whether injection occurred.
- Cross-lane interrupts should be trace-linked so operators can pivot between source event and affected run.

#### Current implementation status (researched)

- Activity page (`apps/web/app/admin/page.tsx`) currently renders grouped work-item events with run status/cost and triage summary/resources.
- Activity data source (`packages/database/src/repositories/jobs.ts:listRecentActivity`) joins `jobs`, `work_items`, `agents`, `inference_calls`, and `activity_log`, but does **not** include queue-message or dispatch-decision detail.
- Work-item run detail (`apps/web/app/admin/work-items/[id]/page.tsx`) shows:
  - per-run triage panel (summary/resources),
  - trace/live run views,
  - and a minimal Internals card listing dispatch IDs and statuses.
- Live run data path (`apps/web/server/routers/jobs.ts` -> `apps/web/server/services/ops/traces.ts`) currently loads messages/spans/background tasks + runControl, but does **not** expose arbiter/interrupt decisions.
- Result: the desired interruption-decision visibility is a target requirement and is not fully implemented in current UI.

### Fallback behavior

- If no valid target can be resolved, do not force interrupt.
- Convert to `do_not_interrupt` and continue normal scheduling.

### Receipts

- Log: decision, target IDs, idempotency key, injection result, and final handling path.
- Receipts must support reconstruction of why a cross-lane interrupt did or did not affect a run.

## Needs -> Architecture -> Gap -> Solution Checklist

Use this as the implementation checklist. Do not mark an item done unless its "Done when" and "Verify in receipts" conditions are satisfied.

### 1) Agents need to handle interruptions while working

- Need: A running agent must handle new incoming messages with autonomy, without being derailed by irrelevant thread traffic.
- Current architecture:
  - Queue lanes are per `sessionKey:agentId`.
  - Steer mode checks pending lane messages and injects them into the active run.
- Gap: Steer injection currently treats pending lane messages too broadly; relevance to the active objective is under-specified.
- Solution:
  - Add a runtime steer relevance gate before in-run injection.
  - Decision outcomes: `interrupt_now`, `do_not_interrupt`, `ignore`.
  - Only `interrupt_now` enters active run context.
- Done when:
  - Unrelated during-run messages do not alter active run behavior.
  - Relevant during-run steer messages still change direction or stop work.
- Verify in receipts:
  - `logs/triage.jsonl`
  - `run_dispatches`/`queue_messages` state transitions
  - activity and span traces showing inject vs non-inject decisions.

### 2) Agents need to decide ignore / stop / change direction themselves

- Need: During active work, agents must independently decide what to do with new instructions.
- Current architecture:
  - Platform control states exist (`continue`, `pause`, `cancel`, `steer`).
  - Runner handles these states in control loops.
- Gap: There is no explicit agent-facing steer decision contract that captures "ignore/stop/change" as a first-class autonomy behavior.
- Solution:
  - Standardize steer prompt framing for injected messages:
    - decide whether to ignore,
    - stop current objective,
    - or continue with changed strategy.
  - Persist the decision rationale in receipts.
- Done when:
  - Injected steer messages reliably produce explicit behavioral choices (not silent ambiguity).
- Verify in receipts:
  - run message history
  - activity log entries with steer rationale
  - span annotations around steering turns.

### 3) Agents need human-like communication in shared channels (including inter-agent)

- Need: Agents should coordinate publicly through the same channels humans use.
- Current architecture:
  - Mention-based inter-agent dispatch creates synthetic work items (`source_type: inter_agent`).
- Gap: Inter-agent behavior is mostly mention-triggered and can over-fit to routing heuristics instead of intent.
- Solution:
  - Keep conversation natural and intent-first by default; do not require special chat syntax.
  - Treat "handoff" as an optional special case (explicit ownership transfer), not the baseline for normal back-and-forth.
  - When explicit ownership transfer is intended, capture it as internal metadata/receipts (transfer intent, target, artifact refs) without forcing protocol keywords in chat text.
  - Keep communication public-first; no private handoff semantics as default.
- Done when:
  - Agents can converse naturally in shared channels without formal protocol requirements.
  - Explicit ownership-transfer cases remain inspectable/reproducible in receipts.
  - Routing behavior is intent-driven, not brittle mention heuristics.
- Verify in receipts:
  - synthetic inter-agent work item payloads
  - activity timeline continuity between source run and target run
  - explicit ownership-transfer metadata only when transfer intent is present.

### 4) Agents need cross-channel awareness (multi-run / multi-integration context)

- Need: If an agent is working in one integration and gets new info in another, it should act with platform-wide context.
- Current architecture:
  - Triage and prompt context are primarily session-scoped.
- Gap: Session-local context can miss active work happening in other integrations/sessions.
- Solution:
  - Add an "active work snapshot" context block (agent-local open runs/jobs across integrations) to triage/runtime context.
  - Use it for interruption relevance decisions and steer interpretation.
- Done when:
  - Cross-channel messages can reference ongoing work and get correctly interpreted as steer vs ignore.
- Verify in receipts:
  - triage reasons mentioning cross-channel active work
  - run traces showing cross-channel context utilization.

### 5) Mention semantics must stay intent-first (not handle-first)

- Need: Mentions can be directive or referential; agents must infer intent, not blindly route by handle.
- Current architecture:
  - Triage prompt already treats mentions as signals.
- Gap: Referential-vs-directive behavior is not explicitly enforced by enough test coverage.
- Solution:
  - Sharpen prompt instructions with explicit examples.
  - Add regression tests for directive, referential, and mixed mention cases.
- Done when:
  - Referential mentions do not cause accidental responses.
  - Directive mentions still route/respond appropriately.
- Verify in receipts:
  - triage outputs (`shouldRespond`, `reason`) for known eval markers
  - test pass results for mention-semantic cases.

## One-Go Implementation Checklist (Local Only)

- [ ] Implement steer relevance gate in runner path.
- [ ] Add explicit steer decision framing for agent turns (`ignore/stop/change`).
- [ ] Implement intent-first inter-agent routing with optional explicit ownership-transfer receipts (not required chat protocol).
- [ ] Add cross-channel active-work context to triage/runtime.
- [ ] Sharpen mention semantics prompt text.
- [ ] Add triage and runner tests for the above behaviors.
- [ ] Update eval matrix with deterministic scenarios and expected receipts.
- [ ] Run full local verification (format, lint, typecheck, tests, webhook eval replay).
