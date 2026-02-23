# PRD: Media Tools + Productivity/Chat Integrations Pack

Date: 2026-02-21
Owner: Platform / Integrations
Status: Draft

## Overview

This PRD defines a capability pack for Nitejar that adds:

1. Image generation tool
2. TTS tool
3. STT tool
4. Notion plugin
5. Slack plugin
6. Google Calendar plugin
7. Google Drive plugin
8. Google Docs plugin
9. Gmail plugin
10. Discord plugin

The goal is to let agents produce/consume richer media, operate inside team communication surfaces, and automate common productivity workflows while preserving receipts, cost tracking, and clear security boundaries.

## Goals

- Expand agent utility beyond text-only workflows.
- Support production-grade inbound and outbound channel integrations.
- Preserve Nitejar "receipts" discipline for every action.
- Ship in phases with a local/self-hosted-friendly MVP path.

## Non-goals

- Full parity with each vendor platform's complete API surface.
- Solving enterprise SSO/compliance for every provider in MVP.
- Building a generalized marketplace/distribution UX in this milestone.

## Success criteria

- At least one agent can complete end-to-end workflows in each new capability area.
- All capability invocations emit traceable receipts (request metadata, status, cost where applicable).
- Integrations tolerate retries/duplicates safely via idempotent ingest.
- Security model is least-privilege by default.

## Scope

### A) Media tools

#### Image generation tool
- MVP:
  - `generate_image(prompt, size?, quality?, output_path?)`
  - Return local file path + metadata (dimensions, mime, model/provider, request id).
- Requirements:
  - Output should be file-based, not base64 pasted into chat context.
  - Cost telemetry must be recorded.

#### TTS tool
- MVP:
  - `synthesize_speech(text, voice, model?, format?, output_path?)`
  - Return audio file path + metadata.
- Requirements:
  - Support common output formats.
  - Cost telemetry + rate limit handling.

#### STT tool
- MVP:
  - `transcribe_audio(input_path_or_attachment, model?, language?)`
  - Return text + optional segments/timestamps.
- Requirements:
  - Respect file size limits.
  - Cost telemetry + rate limit handling.

### B) Collaboration/productivity plugins

#### Notion plugin
- MVP tools:
  - Search pages/data sources, read page/blocks, create/update pages, append blocks, and update data-source-backed content.
- MVP eventing:
  - MVP is active participation/tool-driven CRUD only (no Notion webhook ingestion required).
  - Add webhook ingestion in a later hardening phase.
- Auth:
  - Internal integration token first; OAuth as V1.

#### Slack plugin
- MVP tools:
  - Read thread context, post replies (channel/thread), optional message update.
- MVP eventing:
  - Socket Mode first for local/self-hosted setups.
  - Events API webhook mode as production option.
  - Per-agent inbound policy toggle:
    - mentions-only in allowlisted channels (default), or
    - all messages in allowlisted channels.
  - Private channels and DMs are in MVP scope when app permissions/membership allow it.
- Auth:
  - OAuth install flow and bot/app tokens.

#### Google Calendar plugin
- MVP tools:
  - List calendars, list/get/create/update/delete events, free/busy query.
- Eventing:
  - `events.watch` + incremental sync (`syncToken`) in follow-on phase.
- Auth:
  - OAuth user-delegated first; domain-wide delegation optional later.

#### Google Drive plugin
- MVP tools:
  - Search/list, get metadata, upload/download, create folder, update/delete file.
- Eventing:
  - `changes.watch`/`files.watch` + incremental sync in follow-on phase.
- Auth:
  - OAuth user-delegated first; domain-wide delegation optional later.

#### Google Docs plugin
- MVP tools:
  - Create/get docs, batch updates, Drive-backed search/export.
- Eventing:
  - No direct Docs webhook path expected; use Drive change/watch mechanisms.
- Auth:
  - OAuth user-delegated first.

#### Gmail plugin
- MVP tools:
  - List/search messages, get message/attachment, send, label operations.
- Eventing:
  - Push via `users.watch` + Pub/Sub and `history.list` delta sync in follow-on phase.
- Auth:
  - OAuth user-delegated first.

#### Discord plugin
- MVP tools/flows:
  - Ingest slash command interactions.
  - Deferred ack + follow-up response posting.
  - Register commands (guild-scoped first).
- Eventing:
  - Interactions outgoing webhook mode first (Gateway optional later).
- Auth:
  - Bot/app tokens + OAuth install.

## Cross-cutting product requirements

### 1) Setup and auth UX
- Every plugin instance must have guided setup (required secrets/scopes, test connection).
- OAuth flows must clearly show requested scopes and who granted them.
- Secrets/tokens must never be displayed after initial creation unless explicitly re-issued.
- MVP default auth ownership is shared per plugin instance.
- Follow-on design will add optional per-agent/personal auth ownership and visibility controls.

### 2) Receipts
- Every inbound event and outbound API action must have inspectable receipts:
  - Provider ids (event id/message id/file id/etc.).
  - Retry/attempt metadata.
  - Normalized status.
  - Cost data when applicable.

### 3) Runtime behavior
- Inbound webhook/event ingestion must acknowledge quickly and enqueue durable work.
- Tool calls must enforce capability toggles and per-agent/per-team restrictions.
- Long-running operations should support background execution and polling/check APIs.
- Cross-post actions between Slack/Notion do not require a human approval gate in MVP.

### 4) Rate limits and budgets
- Provider-specific backoff and retry behavior required.
- Quota/rate limit errors should surface in receipts and admin traces.
- Cost controls should support per-agent or per-org policy limits.

### 5) Security and privacy
- Least-privilege scopes by default.
- Token encryption at rest.
- Signature verification for provider webhooks/events.
- Idempotency on all inbound event handling.
- Configurable retention for sensitive payloads/artifacts.
- Add a periodic cleanup job to enforce retention policy for raw payloads and oversized artifacts.

## Phased rollout plan

### Phase 1 (MVP foundation)
- Media tools: image generation, TTS, STT (single provider path).
- Chat plugins: Slack (Socket Mode), Discord interactions webhook.
- Productivity plugins: Notion internal token mode.
- Core receipts/cost instrumentation for all new operations.

### Phase 2 (Google workspace baseline)
- Calendar + Drive + Docs + Gmail OAuth integrations.
- Baseline read/write tool surfaces.
- Pull-sync only where push is not yet hardened.

### Phase 3 (event-driven hardening)
- Gmail push (`watch` + history sync), Drive/Calendar watch renewal lifecycle.
- Notion webhooks production path.
- Strong idempotency/replay/dead-letter operations.

### Phase 4 (enterprise and ergonomics)
- Optional domain-wide delegation modes with strict controls.
- Expanded tool surfaces (bulk ops, templates, richer message operations).
- Higher-level automation routines across integrations.

## Exit criteria

- [ ] Image generation tool works end-to-end with file output + receipts.
- [ ] TTS tool works end-to-end with file output + receipts.
- [ ] STT tool works end-to-end with transcript + receipts.
- [ ] Notion plugin supports read/write MVP operations.
- [ ] Slack plugin supports inbound events and threaded replies.
- [ ] Google Calendar plugin supports event CRUD + free/busy.
- [ ] Google Drive plugin supports file search/upload/download and metadata ops.
- [ ] Google Docs plugin supports create/get/batchUpdate + Drive export workflow.
- [ ] Gmail plugin supports read/search/send and label workflows.
- [ ] Discord plugin supports interaction ingest + deferred follow-up responses.
- [ ] All integrations emit auditable receipts and pass idempotency tests.

## Key risks and unknowns

- Provider quotas/rate limits and pricing can change frequently.
- OAuth verification requirements for sensitive/restricted scopes can affect timeline.
- Push event systems (Gmail/Drive/Calendar) require durable watch renewal and sync cursor management.
- Enterprise auth modes (service account/domain-wide delegation) increase security/compliance burden.

## Source references (official docs)

### OpenAI media
- https://platform.openai.com/docs/guides/image-generation
- https://platform.openai.com/docs/api-reference/images
- https://platform.openai.com/docs/guides/text-to-speech
- https://platform.openai.com/docs/guides/speech-to-text
- https://platform.openai.com/docs/api-reference/audio/createSpeech
- https://platform.openai.com/docs/api-reference/audio/createTranscription
- https://platform.openai.com/docs/guides/background
- https://platform.openai.com/docs/webhooks
- https://platform.openai.com/docs/guides/rate-limits

### Notion
- https://developers.notion.com/reference/intro
- https://developers.notion.com/reference/authentication
- https://developers.notion.com/docs/authorization
- https://developers.notion.com/reference/notion-sdk-js
- https://developers.notion.com/reference/post-search
- https://developers.notion.com/reference/post-page
- https://developers.notion.com/reference/get-block-children
- https://developers.notion.com/reference/patch-block-children
- https://developers.notion.com/reference/query-a-data-source
- https://developers.notion.com/reference/webhooks
- https://developers.notion.com/reference/request-limits

### Slack
- https://docs.slack.dev/authentication/installing-with-oauth
- https://docs.slack.dev/authentication/tokens/
- https://docs.slack.dev/authentication/verifying-requests-from-slack/
- https://docs.slack.dev/apis/events-api/
- https://docs.slack.dev/apis/events-api/using-socket-mode
- https://docs.slack.dev/apis/web-api/rate-limits/
- https://docs.slack.dev/reference/methods/chat.postMessage
- https://docs.slack.dev/reference/methods/conversations.history
- https://docs.slack.dev/reference/methods/conversations.replies

### Google Workspace
- https://developers.google.com/workspace/calendar/api/guides/overview
- https://developers.google.com/workspace/calendar/api/guides/push
- https://developers.google.com/workspace/calendar/api/guides/quota
- https://developers.google.com/workspace/drive/api/guides/about-sdk
- https://developers.google.com/workspace/drive/api/guides/search-files
- https://developers.google.com/workspace/drive/api/guides/push
- https://developers.google.com/drive/api/guides/limits
- https://developers.google.com/workspace/docs/api/reference/rest/v1/documents
- https://developers.google.com/docs/api/limits
- https://developers.google.com/workspace/gmail/api/reference/rest
- https://developers.google.com/workspace/gmail/api/guides/push
- https://developers.google.com/workspace/gmail/api/reference/quota
- https://developers.google.com/identity/protocols/oauth2/web-server

### Discord
- https://discord.com/developers/docs/reference
- https://discord.com/developers/docs/interactions/overview
- https://discord.com/developers/docs/interactions/receiving-and-responding
- https://discord.com/developers/docs/interactions/application-commands
- https://discord.com/developers/docs/topics/oauth2
- https://discord.com/developers/docs/topics/permissions
- https://discord.com/developers/docs/topics/rate-limits
- https://discord.com/developers/docs/events/gateway
- https://discord.com/developers/docs/events/webhook-events
