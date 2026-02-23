# Technical Spec: Media Tools + Integrations Pack

Date: 2026-02-21
Status: Draft
Related PRD: `/Users/josh.matz/Projects/nitejar/nitejar/.taskmaster/docs/prd-integrations-media-tools.md`

## 1) Technical goals

- Add 10 new capabilities with minimal disruption to current architecture.
- Reuse existing plugin handler and agent integration extension points.
- Preserve receipts and cost visibility for every provider call.
- Make inbound event handling durable, idempotent, and debuggable.

## 2) Existing integration points to leverage

- Webhook ingress and dispatch routing:
  - `/Users/josh.matz/Projects/nitejar/nitejar/apps/web/app/api/webhooks/plugins/[type]/[instanceId]/route.ts`
- Plugin handler contracts and registry:
  - `/Users/josh.matz/Projects/nitejar/nitejar/packages/plugin-handlers/src/types.ts`
  - `/Users/josh.matz/Projects/nitejar/nitejar/packages/plugin-handlers/src/index.ts`
- Plugin instance CRUD and setup:
  - `/Users/josh.matz/Projects/nitejar/nitejar/apps/web/server/routers/plugin-instances.ts`
- Agent integration providers:
  - `/Users/josh.matz/Projects/nitejar/nitejar/packages/agent/src/integrations/registry.ts`
- Tool registration and handlers:
  - `/Users/josh.matz/Projects/nitejar/nitejar/packages/agent/src/tools/definitions.ts`
  - `/Users/josh.matz/Projects/nitejar/nitejar/packages/agent/src/tools/handlers/index.ts`
- External API cost receipts:
  - `/Users/josh.matz/Projects/nitejar/nitejar/packages/database/src/repositories/external-api-calls.ts`
  - `/Users/josh.matz/Projects/nitejar/nitejar/packages/agent/src/runner.ts`

## 3) Proposed component architecture

### 3.1 Provider plugins/connectors

Create new provider modules:

- `packages/plugin-handlers/src/notion/`
- `packages/plugin-handlers/src/slack/`
- `packages/plugin-handlers/src/google-calendar/`
- `packages/plugin-handlers/src/google-drive/`
- `packages/plugin-handlers/src/google-docs/`
- `packages/plugin-handlers/src/gmail/`
- `packages/plugin-handlers/src/discord/`

Each should implement:

- `validateConfig`
- `parseWebhook` (or equivalent inbound parser)
- `postResponse` when outbound replies are native to that provider

Create/extend agent-side providers for tool surfaces:

- `packages/agent/src/integrations/notion.ts`
- `packages/agent/src/integrations/slack.ts`
- `packages/agent/src/integrations/google-calendar.ts`
- `packages/agent/src/integrations/google-drive.ts`
- `packages/agent/src/integrations/google-docs.ts`
- `packages/agent/src/integrations/gmail.ts`
- `packages/agent/src/integrations/discord.ts`

### 3.2 Credential path strategy

Use two credential paths intentionally:

- Dedicated provider connectors for first-party integrations (Slack/Notion/Google/Discord/Gmail):
  - Store provider config/tokens in plugin instance config with encrypted sensitive fields.
  - Keep typed tool surfaces and provider-specific guardrails/idempotency.
- `secure_http_request` + agent-assigned credentials as an escape hatch:
  - Use for unsupported endpoints and long-tail APIs.
  - Keep host and location restrictions (`allowed_hosts`, header/query/body controls).

### 3.3 Media tools (OpenAI-first MVP)

Add tool handlers:

- `generate_image`
- `synthesize_speech`
- `transcribe_audio`

Implementation notes:

- Write generated binaries to filesystem and return file metadata.
- For inbound attachments, resolve to local file path before transcription.
- Emit `externalApiCost` metadata consistently.

### 3.4 Background workers

Add workers for watch/subscription lifecycle and sync:

- `gmail-watch-worker`
- `google-drive-watch-worker`
- `google-calendar-watch-worker`
- `notion-polling-worker` (MVP fallback)

Responsibilities:

- Renew expiring watches/channels.
- Pull authoritative changes using stored cursors (`historyId`, `syncToken`, `pageToken`).
- Enqueue normalized work items.

## 4) Data model changes

### 4.1 OAuth connections and token vault

Use plugin-instance-scoped OAuth storage:

- `oauth_connections`
  - `id`, `plugin_instance_id`, `provider`, `account_id`, `account_email`, `scopes`, `status`, timestamps.
- `oauth_tokens`
  - `connection_id`, `access_token_encrypted`, `refresh_token_encrypted`, `expires_at`, rotation timestamps.

Rules:

- Encrypt token fields at rest.
- Never return raw token material from read endpoints.
- Track scope grants for audit and debugging.

MVP ownership model:

- Credentials/tokens are shared per plugin instance.
- Agent access to that auth context is controlled via `agent_plugin_instances`.
- Follow-on design item: optional per-agent/personal auth ownership for "personal agents".

### 4.2 Watch/subscription state

Add table to track provider watch lifecycles:

- `integration_watch_subscriptions`
  - `id`, `plugin_instance_id`, `provider`, `resource_type`, `resource_id`, `channel_id`, `cursor`, `expires_at`, `status`, `last_sync_at`, `last_error`.

Provider mappings:

- Gmail: `historyId` cursor, Pub/Sub topic/subscription metadata.
- Drive: channel/resource ids + page token cursor.
- Calendar: channel/resource ids + `syncToken` cursor.

### 4.3 Optional media artifact metadata

If needed for receipts/search/UI:

- `media_artifacts`
  - `id`, `job_id`, `tool_call_id`, `provider`, `model`, `mime_type`, `path`, `size_bytes`, `duration_ms`, `dimensions_json`, `created_at`.

## 5) Event ingestion and idempotency

### 5.1 Common ingest contract

For every inbound event:

1. Verify signature/authenticity.
2. Build deterministic idempotency key.
3. Insert work item only if key not seen.
4. ACK provider quickly.
5. Process asynchronously via queue/worker.

### 5.2 Suggested idempotency keys

- Slack: `event_id`
- Discord: interaction `id`
- Gmail: `(emailAddress, historyId, pubsubMessageId)`
- Drive/Calendar: `(channelId, resourceId, messageNumber)`
- Notion webhook: provider delivery/event id fields

## 6) Provider-specific technical notes

### 6.1 Slack

- MVP ingress: Socket Mode.
- Production option: Events API webhook + signature verification.
- ACK within provider deadline; heavy work enqueued.
- Respect method-tier rate limits and special posting constraints.
- Support inbound policy toggle per agent:
  - mentions-only in allowlisted channels (default), or
  - all messages in allowlisted channels.
- Private channels and DMs are in MVP scope when scopes/membership permit.

### 6.2 Discord

- MVP ingress: Interaction webhook mode.
- Must validate Ed25519 signatures.
- Must send initial response within 3 seconds (deferred ACK pattern).
- Use follow-up webhook endpoints for full agent responses.

### 6.3 Notion

- MVP: internal integration token + explicit page/data source sharing.
- MVP is active participation/tool-driven CRUD only; no webhook dependency in MVP.
- Data source updates are in MVP scope.
- Webhook ingestion can be added in a hardening phase.
- Respect request and payload limits; batch append operations.

### 6.4 Google Calendar/Drive/Docs/Gmail

- OAuth web-server flow first.
- Use least-privilege scopes and explicit scope templates.
- Docs events derived from Drive watch/change mechanisms.
- Gmail push requires Pub/Sub + watch renewal + history delta sync.

### 6.5 Media tools

- OpenAI-first to reduce integration complexity.
- Separate synchronous and background execution modes.
- Add strict size/duration limits and file cleanup policy.

## 7) Security model

- Encrypt all provider secrets/tokens.
- Verify webhook signatures for Slack/Discord/Notion and any Google callback path where applicable.
- Restrict scopes and bot permissions by default.
- Enforce allow/deny guardrails per tool and per integration instance.
- Log all secret updates and auth grant/revoke actions with audit receipts.
- Add retention policy config for raw inbound payloads and artifact blobs.
- Add periodic cleanup worker to enforce retention TTLs.

## 8) Observability and receipts

Add explicit provider receipt attributes to traces/messages where relevant:

- Request id / response id
- Event id / message id / resource id
- Retry count and backoff decisions
- Quota/rate-limit headers and failure codes
- Token refresh attempts and outcomes

UI updates needed:

- Extend trace view formatting to render new tool calls and media artifacts.
- Add integration health indicators for watch renewals/cursor lag.

## 9) Testing strategy

### 9.1 Unit tests

- Signature verification (Slack/Discord/Notion).
- OAuth callback and token refresh flows.
- Idempotency key generation and duplicate suppression.
- Tool input validation and policy checks.

### 9.2 Integration tests

- Mock provider webhook payloads and assert work-item creation.
- Mock provider API calls for read/write tool handlers.
- Verify retries/backoff on synthetic rate-limit responses.
- Verify receipts written for success/failure paths.

### 9.3 End-to-end local tests

- Slack Socket Mode happy path.
- Discord slash command -> deferred ack -> follow-up response.
- Notion read/write operations on shared test page.
- Google OAuth link + one operation per plugin.
- Media pipeline: generate image, synthesize speech, transcribe audio.

## 10) Rollout sequence (engineering)

1. Add media tools + receipts + capability toggles.
2. Add Slack + Discord chat integrations (highest immediate value).
3. Add Notion read/write baseline.
4. Add Google OAuth substrate shared by Calendar/Drive/Docs/Gmail.
5. Add Google plugin tool surfaces.
6. Add watch/sync workers for Gmail/Drive/Calendar.
7. Harden ops: retries, health dashboards, audit/alerts.

## 11) Decisions and open items

Decisions captured:

- Slack trigger model is per-agent configurable (mentions-only default vs all messages in allowlisted channels).
- Slack private channels/DMs are included in MVP.
- Notion MVP includes CRUD and data source updates, without webhook dependency.
- Cross-posting between Slack and Notion does not require approval gate in MVP.
- First-party integrations use dedicated typed connectors; `secure_http_request` remains escape hatch only.

Still open:

- OAuth ownership for personal agents: shared plugin-instance credentials only, or optional per-agent credential ownership.
- Default retention windows for raw payloads vs normalized receipts.
- Should media artifacts be indexed in DB by default or only referenced via filesystem receipts?
- Do we support domain-wide delegation in same milestone or isolate it behind enterprise flag?

## 12) Source appendix (official docs)

- OpenAI media APIs and guides:
  - https://platform.openai.com/docs/guides/image-generation
  - https://platform.openai.com/docs/guides/text-to-speech
  - https://platform.openai.com/docs/guides/speech-to-text
  - https://platform.openai.com/docs/guides/background
  - https://platform.openai.com/docs/webhooks
- Slack:
  - https://docs.slack.dev/apis/events-api/
  - https://docs.slack.dev/apis/events-api/using-socket-mode
  - https://docs.slack.dev/authentication/verifying-requests-from-slack/
  - https://docs.slack.dev/apis/web-api/rate-limits/
- Notion:
  - https://developers.notion.com/reference/intro
  - https://developers.notion.com/reference/webhooks
  - https://developers.notion.com/reference/request-limits
- Google Workspace:
  - https://developers.google.com/identity/protocols/oauth2/web-server
  - https://developers.google.com/workspace/gmail/api/guides/push
  - https://developers.google.com/workspace/drive/api/guides/push
  - https://developers.google.com/workspace/calendar/api/guides/push
  - https://developers.google.com/workspace/docs/api/reference/rest/v1/documents
- Discord:
  - https://discord.com/developers/docs/interactions/receiving-and-responding
  - https://discord.com/developers/docs/topics/rate-limits
  - https://discord.com/developers/docs/topics/oauth2
