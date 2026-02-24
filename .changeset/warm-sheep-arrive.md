---
"@nitejar/cli": minor
---

Add built-in Slack integration with manifest-based setup, agent tools, and inter-agent handoffs.

- **Slack plugin handler** — manifest-based app creation flow, signature-verified webhooks, threaded replies, eyes-reaction receipts, mentions/all inbound policy, allowed-channel filtering, and final response mode.
- **Agent Slack tools** — 7 tools (read thread, channel history, channel info, list channels, search messages, workspace context search, export response) gated by per-agent assignment policy (allow_all / allow_list).
- **Inter-agent mention handoffs** — when enabled, an agent's final response can transfer to another agent via explicit @-mention phrasing, up to chain depth 3.
- **Runtime app base URL** — public URL can now be set via Settings > Runtime, taking precedence over environment variables.
- **Webhook routing hardening** — idempotency improvements, Slack event deduplication, redirect-flow plugin creation.
- **Plugin instance UI** — expanded detail page with Slack-specific config, manifest generation, and agent assignment policy controls.
- **Docs** — Slack setup guide, updated built-in integration references, base URL resolution precedence, assignment policy documentation.
- **Sprites** — token settings support, e2e test fixtures, background task and session improvements.
