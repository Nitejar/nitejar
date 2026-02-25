---
"@nitejar/web": patch
"@nitejar/agent": patch
"@nitejar/plugin-handlers": patch
---

Improve Slack bot-mention handling so ingress context is preserved without breaking routing.

- Parse and persist Slack bot-mention metadata (`slackBotMentioned`, bot identity fields) on inbound work items.
- Preserve mention-prefixed Slack message bodies in queue payloads while still stripping the app mention for slash-command parsing.
- Add Slack ingress context to agent triage/routing prompts so app-handle mentions are treated as transport context, not teammate-routing evidence.
- Tighten Slack receipt reactions in `inboundPolicy: all` mode to avoid adding eyes reactions when a message was not a bot mention.
- Split Slack plugin-instance settings UI into separate credential and message-intake save flows for safer partial updates.
