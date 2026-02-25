# @nitejar/connectors-slack

## 0.1.0

### Minor Changes

- [`e88fa46`](https://github.com/Nitejar/nitejar/commit/e88fa461ac7f87b0af05dd6673cbfb6fabd32acb) Thanks [@joshmatz](https://github.com/joshmatz)! - Add Slack image/file attachment support and fix sender identity across agent pipeline
  - Slack images pasted in channels are now extracted from webhook events, downloaded with bot token auth, and sent to the model as multimodal image inputs (up to 4 images, 4MB each)
  - Sender identity (name, handle, platform user ID) is now always included in agent context, even when messages are coalesced from the dispatch queue
  - Slack user mentions use native `<@U...>` format so agents can tag users correctly
  - Session history no longer leaks internal reasoning labels into model output — intermediate reasoning is injected as user-role scratchpad, final responses are clean assistant messages
  - Routing arbiter prompts use concrete agent names instead of generic "target agent" language
  - Post-processing preserves substantive content instead of reducing it to meta-summaries
