# @nitejar/plugin-handlers

## 0.1.0

### Minor Changes

- [`e88fa46`](https://github.com/Nitejar/nitejar/commit/e88fa461ac7f87b0af05dd6673cbfb6fabd32acb) Thanks [@joshmatz](https://github.com/joshmatz)! - Add Slack image/file attachment support and fix sender identity across agent pipeline
  - Slack images pasted in channels are now extracted from webhook events, downloaded with bot token auth, and sent to the model as multimodal image inputs (up to 4 images, 4MB each)
  - Sender identity (name, handle, platform user ID) is now always included in agent context, even when messages are coalesced from the dispatch queue
  - Slack user mentions use native `<@U...>` format so agents can tag users correctly
  - Session history no longer leaks internal reasoning labels into model output — intermediate reasoning is injected as user-role scratchpad, final responses are clean assistant messages
  - Routing arbiter prompts use concrete agent names instead of generic "target agent" language
  - Post-processing preserves substantive content instead of reducing it to meta-summaries

### Patch Changes

- [`8224356`](https://github.com/Nitejar/nitejar/commit/8224356fc0774ed4240ceadc60fdd40e876b48ae) Thanks [@joshmatz](https://github.com/joshmatz)! - Improve Slack bot-mention handling so ingress context is preserved without breaking routing.
  - Parse and persist Slack bot-mention metadata (`slackBotMentioned`, bot identity fields) on inbound work items.
  - Preserve mention-prefixed Slack message bodies in queue payloads while still stripping the app mention for slash-command parsing.
  - Add Slack ingress context to agent triage/routing prompts so app-handle mentions are treated as transport context, not teammate-routing evidence.
  - Tighten Slack receipt reactions in `inboundPolicy: all` mode to avoid adding eyes reactions when a message was not a bot mention.
  - Split Slack plugin-instance settings UI into separate credential and message-intake save flows for safer partial updates.

- Updated dependencies [[`e88fa46`](https://github.com/Nitejar/nitejar/commit/e88fa461ac7f87b0af05dd6673cbfb6fabd32acb)]:
  - @nitejar/connectors-slack@0.1.0
