# @nitejar/cli

## 0.3.0

### Minor Changes

- [#15](https://github.com/Nitejar/nitejar/pull/15) [`0cf1409`](https://github.com/Nitejar/nitejar/commit/0cf14097836c5edbee021b656518db9c59e225e2) Thanks [@joshmatz](https://github.com/joshmatz)! - Add built-in Slack integration with manifest-based setup, agent tools, and inter-agent handoffs.
  - **Slack plugin handler** — manifest-based app creation flow, signature-verified webhooks, threaded replies, eyes-reaction receipts, mentions/all inbound policy, allowed-channel filtering, and final response mode.
  - **Agent Slack tools** — 7 tools (read thread, channel history, channel info, list channels, search messages, workspace context search, export response) gated by per-agent assignment policy (allow_all / allow_list).
  - **Runtime app base URL** — public URL can now be set via Settings > Runtime, taking precedence over environment variables.
  - **Webhook routing hardening** — idempotency improvements, Slack event deduplication, redirect-flow plugin creation.
  - **Plugin instance UI** — expanded detail page with Slack-specific config, manifest generation, and agent assignment policy controls.
  - **Docs** — Slack setup guide, updated built-in integration references, base URL resolution precedence, assignment policy documentation.
  - **Sprites** — token settings support, e2e test fixtures, background task and session improvements.

## 0.2.3

### Patch Changes

- [#10](https://github.com/Nitejar/nitejar/pull/10) [`b6dd1ec`](https://github.com/Nitejar/nitejar/commit/b6dd1ecb9a01c4d95f234355b19dcb61fb54e825) Thanks [@joshmatz](https://github.com/joshmatz)! - Improve `nitejar up` startup output to always print the actual local URL and show configured `APP_BASE_URL` separately when it differs. Also harden `--port auto` startup retries to move to the next port after an in-use collision.

## 0.2.2

### Patch Changes

- [#8](https://github.com/Nitejar/nitejar/pull/8) [`31cb3f0`](https://github.com/Nitejar/nitejar/commit/31cb3f0c6dfcb8815bf6fcf661180edd019bf460) Thanks [@joshmatz](https://github.com/joshmatz)! - Improve `nitejar up` startup output to always print the actual local URL and show configured `APP_BASE_URL` separately when it differs. Also harden `--port auto` startup retries to move to the next port after an in-use collision.

## 0.2.1

### Patch Changes

- [#2](https://github.com/Nitejar/nitejar/pull/2) [`a6226c1`](https://github.com/Nitejar/nitejar/commit/a6226c1b451764bb0f28d7269b907e92abb35190) Thanks [@joshmatz](https://github.com/joshmatz)! - Auto-rebuild `better-sqlite3` during migration preflight when the packaged native module ABI
  doesn't match the current Node runtime, preventing startup failures after runtime install/update.

## 0.2.0

### Minor Changes

- [`5f133ba`](https://github.com/Nitejar/nitejar/commit/5f133ba48c6ced3695dc5b64e62f1a46f0bdd95f) Thanks [@joshmatz](https://github.com/joshmatz)! - Add first-boot onboarding wizard to `nitejar up`. On first launch, the CLI walks through access mode, base URL, port, and optional API key. Every step can be skipped. Use `--no-wizard` to disable. Also auto-generates BETTER_AUTH_SECRET for session signing.
