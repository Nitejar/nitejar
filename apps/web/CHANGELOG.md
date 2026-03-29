# @nitejar/web

## 0.1.0

### Minor Changes

- [`efa992b`](https://github.com/Nitejar/nitejar/commit/efa992b53fbcae1164d145dabcb34a9b20bdce46) Thanks [@joshmatz](https://github.com/joshmatz)! - Reframe the app around Command Center, typed routine targets, and clearer work receipts.
  - Replace the old Fleet landing flow with a Command Center-first navigation and tighten hierarchy across company, work, agent, and detail surfaces.
  - Add typed routine targets for app sessions, tickets, goals, and routines so recurring work can resume or start fresh with clearer intent.
  - Improve work-item receipts with descendant run cost rollups, better trace/context displays, and extracted webhook processing flow.
  - Add agent explore-runner support for scoped read-only codebase investigation.

### Patch Changes

- Updated dependencies [[`efa992b`](https://github.com/Nitejar/nitejar/commit/efa992b53fbcae1164d145dabcb34a9b20bdce46)]:
  - @nitejar/agent@0.2.0

## 0.0.2

### Patch Changes

- [`8224356`](https://github.com/Nitejar/nitejar/commit/8224356fc0774ed4240ceadc60fdd40e876b48ae) Thanks [@joshmatz](https://github.com/joshmatz)! - Improve Slack bot-mention handling so ingress context is preserved without breaking routing.
  - Parse and persist Slack bot-mention metadata (`slackBotMentioned`, bot identity fields) on inbound work items.
  - Preserve mention-prefixed Slack message bodies in queue payloads while still stripping the app mention for slash-command parsing.
  - Add Slack ingress context to agent triage/routing prompts so app-handle mentions are treated as transport context, not teammate-routing evidence.
  - Tighten Slack receipt reactions in `inboundPolicy: all` mode to avoid adding eyes reactions when a message was not a bot mention.
  - Split Slack plugin-instance settings UI into separate credential and message-intake save flows for safer partial updates.

- Updated dependencies [[`e88fa46`](https://github.com/Nitejar/nitejar/commit/e88fa461ac7f87b0af05dd6673cbfb6fabd32acb), [`8224356`](https://github.com/Nitejar/nitejar/commit/8224356fc0774ed4240ceadc60fdd40e876b48ae)]:
  - @nitejar/agent@0.1.0
  - @nitejar/plugin-handlers@0.1.0
  - @nitejar/plugin-runtime@0.0.1

## 0.0.1

### Patch Changes

- [#15](https://github.com/Nitejar/nitejar/pull/15) [`0cf1409`](https://github.com/Nitejar/nitejar/commit/0cf14097836c5edbee021b656518db9c59e225e2) Thanks [@joshmatz](https://github.com/joshmatz)! - Improve auth and post-login UX reliability, and make passive-memory costs auditable in traces.
  - Detect stale auth cookies in app layout, force sign-out, and redirect to login with a clear invalid-session error.
  - Pass server session user info into the sidebar and reduce post-login "Account" flashes by retrying session hydration once before fallback.
  - Replace the sidebar placeholder glyph with the Nitejar icon in desktop and mobile headers.
  - Default passive-memory extract/refine calls to the free model (`arcee-ai/trinity-large-preview:free`) unless overridden by env.
  - Record passive-memory inference metadata (`attempt_kind`, `attempt_index`, `model_span_id`) and expose passive-memory call receipts in TraceView, including token/cost details.
