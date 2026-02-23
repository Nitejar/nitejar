# Notion + Slack Plugin Implementation Notes for Nitejar

Date: 2026-02-21

## 1) Capability summary
- Notion plugin: Let agents read and write workspace knowledge (pages, blocks, data sources), attach durable receipts (page URLs/IDs, block IDs, timestamps), and optionally react to Notion-side events.
- Slack plugin: Let agents participate in channels/threads, respond to mentions and messages, and keep auditable receipts (channel/thread/message ts, event_id, retries, response status).
- Local/self-hosted first default: Slack should start with Socket Mode to avoid public ingress; Notion should start with internal integration token + shared pages/data sources, then add webhooks once a public endpoint is available.

## 2) Official APIs/SDKs and auth model
- Notion APIs: Notion REST API endpoints for search, pages, blocks, data sources, users, comments, and webhooks.
- Notion SDK: Official JavaScript client `@notionhq/client`.
- Notion auth model: Internal integration token for single-workspace installs, or OAuth 2.0 authorization code flow (`/v1/oauth/authorize` -> `/v1/oauth/token`) for user-facing installs; bearer auth plus required `Notion-Version` header.
- Notion token lifecycle: Access tokens can be refreshed via refresh token endpoint.
- Slack APIs: Web API (methods like `chat.postMessage`, `conversations.history`, `conversations.replies`), Events API, and Socket Mode.
- Slack SDKs: Bolt for JavaScript and Node Slack Web API SDK.
- Slack auth model: OAuth 2.0 install flow returning bot/user tokens; token types include bot (`xoxb-*`), user (`xoxp-*`), app-level (`xapp-*`) for Socket Mode, and incoming webhook tokens.
- Slack request auth/integrity: Verify `X-Slack-Signature` and `X-Slack-Request-Timestamp` on inbound HTTP events.

## 3) Core operations we need (MVP tool surface)
| Surface | Notion plugin MVP | Slack plugin MVP |
|---|---|---|
| Read/search | `notion_search(query, filter=page|data_source)`; `notion_get_page(page_id)`; `notion_get_block_children(block_id)` | `slack_get_thread(channel, thread_ts)` via `conversations.replies`; optional `slack_get_channel_history(channel, cursor)` |
| Write | `notion_create_page(parent,data)`; `notion_update_page(page_id,properties)`; `notion_append_blocks(block_id,children)` | `slack_post_message(channel,text,thread_ts?)`; optional `slack_update_message(channel,ts,text)` |
| Structured data | `notion_query_data_source(data_source_id,filter,sort,cursor)` | Optional for MVP |
| Inbound events | Optional in MVP; parse Notion webhook events into work items | Required in MVP; parse Slack events/mentions/messages into work items |
| Agent response mode | `final` (Notion is document-first, not chat-first) | `streaming` default for chat UX; allow `final` toggle per instance |

## 4) Webhook/event options
- Notion option A (local-first): Polling fallback (scheduled `search` or targeted page/data source queries) when no public webhook URL is available.
- Notion option B: Webhooks (subscription + event delivery) once public URL exists; verify signatures using `X-Notion-Signature` and `X-Notion-Request-Timestamp`.
- Notion delivery note: Event envelope includes delivery metadata such as `attempt_number` (docs show attempts up to 8).
- Slack option A (recommended local/self-hosted): Socket Mode over WebSocket with app-level token (`xapp-*`), so no public request URL is required.
- Slack option B: Events API over HTTPS webhook endpoint with URL verification challenge and signed request verification.
- Slack delivery behavior: HTTP events must be acknowledged quickly (3s), retries occur when delivery fails, and high sustained failure rates can disable event subscriptions.

## 5) Rate limits/quotas/pricing considerations
- Notion request rate: Average ~3 requests/second per integration, with burst allowance; `429` responses include `Retry-After`.
- Notion payload limits: Request payload size and block-array limits apply (including max block elements and max request bytes); these should shape batching/chunking behavior.
- Slack Web API limits: Per-method, per-workspace, per-app minute windows with tiered quotas and burst tolerance.
- Slack posting limit: `chat.postMessage` has special behavior, including roughly 1 message/second per channel plus workspace-level controls.
- Slack Events API quota: 30,000 event deliveries per workspace/team per app per 60 minutes.
- Slack commercial distribution caveat: For commercially distributed apps that are not Slack Marketplace-approved, stricter limits for `conversations.history` and `conversations.replies` apply to new apps from 2025-05-29 and to existing installs from 2026-03-03.
- Pricing model practical note: API docs focus on limits/quotas rather than per-call billing. For self-hosted Nitejar planning, budget primarily for your own infra + any Slack/Notion workspace plan requirements.

## 6) Security/data handling concerns
- Encrypt plugin secrets at rest in plugin config (`sensitiveFields`) and require `ENCRYPTION_KEY` in production.
- Keep least-privilege scopes/capabilities by default; only request read/write scopes needed by MVP operations.
- Verify all inbound signatures before parsing payloads (Slack and Notion).
- Use event IDs as idempotency keys to prevent duplicate work item creation during retries.
- Redact tokens/secrets from logs, traces, receipts, and tool results.
- Bound outbound data egress: when writing back to Notion/Slack, avoid dumping full private context; keep responses scoped to the request.
- Token hygiene: support token rotation/refresh paths and explicit re-auth UX.

## 7) Recommended Nitejar plugin/tool architecture integration points
- Implement plugin handlers in `~/Projects/nitejar/nitejar/packages/plugin-handlers/src/notion/index.ts` and `~/Projects/nitejar/nitejar/packages/plugin-handlers/src/slack/index.ts` using the existing `PluginHandler` contract (`validateConfig`, `parseWebhook`, `postResponse`).
- Register handlers in `~/Projects/nitejar/nitejar/packages/plugin-handlers/src/index.ts` so webhook routing can resolve by `type`.
- Reuse existing webhook ingress route `~/Projects/nitejar/nitejar/apps/web/app/api/webhooks/plugins/[type]/[instanceId]/route.ts`; no new generic route needed.
- Add integration providers in `~/Projects/nitejar/nitejar/packages/agent/src/integrations/notion.ts` and `~/Projects/nitejar/nitejar/packages/agent/src/integrations/slack.ts` to contribute tool definitions/handlers and source-specific prompt sections.
- Import/self-register new providers in `~/Projects/nitejar/nitejar/packages/agent/src/runner.ts` (same pattern used for GitHub/Telegram).
- Add typed config parsers + encrypted secret handling (pattern from GitHub config helpers) for tokens, signing secrets, app-level tokens, OAuth client creds, and webhook secret(s).
- Use setup wizard metadata (`setupConfig`) in handler definitions so Admin UI can render instance forms without custom UI work.
- For OAuth callback UX, mirror GitHub callback flow with provider-specific callback page(s) under `~/Projects/nitejar/nitejar/apps/web/app/admin/plugins/<provider>/callback/` and tRPC exchange endpoints.
- Normalize inbound actor/session mapping in `parseWebhook`: Slack should key sessions by channel+thread; Notion should key by page/data-source context + actor.
- Set default response modes by channel ergonomics: Slack `streaming`, Notion `final`.

## 8) Phased rollout (MVP -> V1)
- Phase 0 (local bootstrap): Slack Socket Mode + bot token + minimal scopes; Notion internal integration token with manual page/data source sharing; outbound-only tools for both.
- Phase 1 (MVP productionable): Slack Events API support (HTTP + signature + retries + idempotency) and inbound message handling; Notion read/write tools with batching/chunking + Retry-After handling; admin setup/test connection for both plugins.
- Phase 2 (V1): OAuth install flows for multi-workspace installs, token refresh/rotation UX, richer operations (Slack reactions/files, Notion comments/templates), and high-signal receipts views (event receipt + API call receipt + cost receipt).
- Phase 3 (hardening): Backoff + queue controls per provider, dead-letter/replay harness for failed webhook events, scoped permission presets, and integration evals.

## 9) Decision log (2026-02-21)
- Slack inbound policy is configurable per agent. Support both:
  - mentions-only in explicitly allowed channels (default), and
  - all messages in explicitly allowed channels.
- Slack private channels and DMs are in MVP scope when the app is installed with required scopes and channel membership.
- Notion MVP includes CRUD, including data source participation (not only read + append).
- Notion MVP does not require Notion webhooks. Start with active participation/tool-driven CRUD only.
- Cross-post approval gate is not required for MVP. Revisit once generalized approval flows land.
- Provider API paths should use dedicated connectors for first-party plugins (Slack/Notion/etc.). Keep `secure_http_request` as an escape hatch for unsupported endpoints.
- OAuth ownership model is still open:
  - MVP default: per-plugin-instance shared credentials.
  - Follow-on: optional per-agent/personal installs and visibility controls (for personal agents/teams/private runs).
- Retention policy is still open and should be formalized:
  - add configurable retention windows for raw payloads vs normalized receipts,
  - add a periodic cleanup worker to enforce TTLs.

## 10) Source links (official primary docs only)
### Notion
- [Notion API intro](https://developers.notion.com/reference/intro)
- [Authentication](https://developers.notion.com/reference/authentication)
- [Authorization (OAuth)](https://developers.notion.com/docs/authorization)
- [Create token endpoint (OAuth exchange)](https://developers.notion.com/reference/create-a-token)
- [Refresh token endpoint](https://developers.notion.com/reference/refresh-a-token)
- [Versioning](https://developers.notion.com/reference/versioning)
- [JavaScript SDK](https://developers.notion.com/reference/notion-sdk-js)
- [Search endpoint](https://developers.notion.com/reference/post-search)
- [Create page](https://developers.notion.com/reference/post-page)
- [Retrieve block children](https://developers.notion.com/reference/get-block-children)
- [Append block children](https://developers.notion.com/reference/patch-block-children)
- [Query data source](https://developers.notion.com/reference/query-a-data-source)
- [Webhooks overview](https://developers.notion.com/reference/webhooks)
- [Webhooks: event delivery](https://developers.notion.com/reference/webhooks-events-delivery)
- [Webhooks: request verification](https://developers.notion.com/reference/webhooks-verification)
- [Request limits](https://developers.notion.com/reference/request-limits)

### Slack
- [Installing with OAuth](https://docs.slack.dev/authentication/installing-with-oauth)
- [Token types](https://docs.slack.dev/authentication/tokens/)
- [Verifying requests from Slack](https://docs.slack.dev/authentication/verifying-requests-from-slack/)
- [Events API](https://docs.slack.dev/apis/events-api/)
- [Using Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode)
- [Web API rate limits](https://docs.slack.dev/apis/web-api/rate-limits/)
- [chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage)
- [conversations.history](https://docs.slack.dev/reference/methods/conversations.history)
- [conversations.replies](https://docs.slack.dev/reference/methods/conversations.replies)
- [Bolt for JavaScript](https://docs.slack.dev/tools/bolt-js)
- [Node Slack SDK (Web API)](https://docs.slack.dev/tools/node-slack-sdk/web-api/)
