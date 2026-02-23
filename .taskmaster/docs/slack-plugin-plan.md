# Slack Plugin Implementation Plan

## Goal

Let agents participate in Slack channels and threads — receiving messages, responding in context, and keeping auditable receipts. Local-first via Socket Mode; HTTP Events API as a follow-on.

---

## Architecture Overview

Three new code areas, following the Telegram/GitHub pattern exactly:

| Layer | Package | Purpose |
|-------|---------|---------|
| **Connector** | `packages/connectors-slack/` | Slack Web API client, signature verification, message formatting |
| **Plugin handler** | `packages/plugin-handlers/src/slack/` | `PluginHandler` implementation: config, webhook parsing, response posting |
| **Integration provider** | `packages/agent/src/integrations/slack.ts` | Agent tools + system prompt sections for Slack context |

No new routes, no new DB tables. The existing webhook route, plugin instance table, and work item pipeline handle everything.

---

## Phase 1: Connector Package (`packages/connectors-slack/`)

New workspace package. Thin wrapper over Slack Web API — no Bolt dependency for MVP.

### Files

```
packages/connectors-slack/
  src/
    index.ts              # Re-exports
    slack-client.ts       # Authenticated Web API caller (xoxb token)
    post-message.ts       # chat.postMessage / chat.update helpers
    conversations.ts      # conversations.replies, conversations.history
    verify-request.ts     # X-Slack-Signature verification
    format.ts             # Markdown -> Slack mrkdwn conversion
    types.ts              # Slack event/message type definitions
  package.json
  tsconfig.json
```

### Key decisions

- **No Bolt SDK in MVP.** We parse events ourselves (same pattern as `connectors-github`). Bolt adds WebSocket lifecycle management we don't need until Socket Mode.
- **Rate limit handling.** `slack-client.ts` reads `Retry-After` headers and throws a typed `SlackRateLimitError` so callers can back off. The plugin handler catches this and returns `{ retryable: true }`.
- **Token type.** MVP uses a single bot token (`xoxb-*`). The client constructor takes `{ botToken: string }`.

### `slack-client.ts` surface

```typescript
export function createSlackClient(config: { botToken: string }): SlackClient
// SlackClient methods:
//   postMessage(channel, text, opts?)  -> ts
//   updateMessage(channel, ts, text)   -> void
//   getThread(channel, threadTs, opts?) -> SlackMessage[]
//   getHistory(channel, opts?)         -> SlackMessage[]
//   addReaction(channel, ts, emoji)    -> void
//   removeReaction(channel, ts, emoji) -> void
```

### `verify-request.ts`

```typescript
export function verifySlackRequest(
  rawBody: string,
  signature: string,
  timestamp: string,
  signingSecret: string
): boolean
```

Standard HMAC-SHA256 comparison using `X-Slack-Signature` and `X-Slack-Request-Timestamp`. Reject if timestamp drift > 5 minutes.

---

## Phase 2: Plugin Handler (`packages/plugin-handlers/src/slack/`)

### Files

```
packages/plugin-handlers/src/slack/
  index.ts          # PluginHandler export
  config.ts         # Zod schema, SlackConfig type, sensitive fields
  parse-webhook.ts  # Event parsing -> WebhookParseResult
  types.ts          # SlackResponseContext, event envelope types
```

### Config schema

```typescript
interface SlackConfig {
  botToken: string           // xoxb-* (required)
  signingSecret: string      // Webhook signature verification (required)
  botUserId?: string         // Populated on testConnection, used to filter self-messages
  allowedChannels?: string[] // Channel IDs; empty = all channels the bot is in
  inboundPolicy?: 'mentions' | 'all'  // Default: 'mentions'
}

const SLACK_SENSITIVE_FIELDS = ['botToken', 'signingSecret'] as const
```

### Handler definition

```typescript
export const slackHandler: PluginHandler<SlackConfig> = {
  type: 'slack',
  displayName: 'Slack',
  description: 'Receive messages from Slack channels and respond in threads.',
  icon: 'brand-slack',
  category: 'messaging',
  sensitiveFields: [...SLACK_SENSITIVE_FIELDS],
  responseMode: 'streaming',

  setupConfig: {
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', required: true,
        placeholder: 'xoxb-...', helpText: 'Bot User OAuth Token from your Slack app.' },
      { key: 'signingSecret', label: 'Signing Secret', type: 'password', required: true,
        placeholder: 'abc123...', helpText: 'Found in Basic Information > App Credentials.' },
      { key: 'inboundPolicy', label: 'Listen for', type: 'select', required: false,
        options: [
          { label: 'Mentions only (recommended)', value: 'mentions' },
          { label: 'All messages in allowed channels', value: 'all' },
        ] },
    ],
    credentialHelpUrl: 'https://api.slack.com/apps',
    credentialHelpLabel: 'Create a Slack app',
    supportsTestBeforeSave: true,
  },

  validateConfig(config) { /* zod parse */ },

  async parseWebhook(request, pluginInstance) {
    return parseSlackWebhook(request, pluginInstance)
  },

  async postResponse(pluginInstance, workItemId, content, responseContext, options) {
    // Post to channel/thread via slack-client
    // If streaming, use chat.update on the same message ts
    // If final, post a new message in the thread
  },

  async testConnection(config) {
    // Call auth.test to verify token and get bot user ID
    // Store botUserId back into config for self-filtering
  },

  async acknowledgeReceipt(pluginInstance, responseContext) {
    // Add eyes emoji reaction to the triggering message
  },
}
```

### Webhook parsing (`parse-webhook.ts`)

Flow:

1. **Verify signature** using `verifySlackRequest()`.
2. **Handle URL verification challenge** — if `type === 'url_verification'`, return `{ challenge }` immediately (Slack setup handshake).
3. **Parse event envelope** — extract `event.type`, `event.channel`, `event.thread_ts`, `event.user`, `event.text`.
4. **Filter self-messages** — skip if `event.user === config.botUserId` or `event.bot_id` is present.
5. **Apply inbound policy** — if `inboundPolicy === 'mentions'`, skip messages that don't contain `<@{botUserId}>`.
6. **Check allowed channels** — if `allowedChannels` is set, skip messages outside the list.
7. **Build session key** — `slack:{channel}:{thread_ts || message_ts}` (thread-scoped sessions).
8. **Build response context:**
   ```typescript
   { channel: string, threadTs: string, messageTs: string }
   ```
9. **Return `WebhookParseResult`** with idempotency key `slack:{event_id}`.

### Response context

```typescript
interface SlackResponseContext {
  channel: string
  threadTs: string   // Thread parent ts (reply in thread)
  messageTs: string  // Original message ts (for reactions)
}
```

### Registration

Add to `packages/plugin-handlers/src/registry.ts`:
```typescript
pluginHandlerRegistry.register(slackHandler)
```

---

## Phase 3: Integration Provider (`packages/agent/src/integrations/slack.ts`)

Self-registering provider that contributes tools and system prompt context.

### Tools (MVP)

| Tool | Purpose |
|------|---------|
| `slack_post_message` | Send a message to a channel/thread |
| `slack_get_thread` | Read a thread's message history |
| `slack_get_channel_history` | Read recent messages from a channel |

### System prompt section

Short platform context telling the agent it's operating in Slack — use threads, keep messages concise, use mrkdwn formatting, mention users with `<@USER_ID>`.

### Registration

Add import to `packages/agent/src/runner.ts`:
```typescript
import './integrations/slack'
```

---

## Phase 4: Webhook Route — URL Verification

The existing route at `apps/web/app/api/webhooks/plugins/[type]/[instanceId]/route.ts` calls `handler.parseWebhook()` and expects a `WebhookParseResult`. But Slack's URL verification challenge needs to return a specific JSON body.

**Option A (preferred):** Handle the challenge inside `parseSlackWebhook` by returning `{ shouldProcess: false }` with a special `challenge` field, and let the route detect and return it. This requires a small addition to the webhook route to check for a `challengeResponse` field on the parse result.

**Option B:** Add a `handleChallenge` method to the handler interface. More invasive.

Recommend Option A — minimal change to the shared route, Slack-specific logic stays in the Slack handler.

---

## Phase 5: Admin UI

No custom UI work needed. The `setupConfig` on the handler drives the existing install wizard (`PluginInstallWizard`) and instance detail page (`InstanceDetailClient`). The `DynamicFields` component renders the form fields from the config.

### What the admin sees

1. Plugin catalog shows "Slack" card with the brand-slack icon.
2. Click "Install" -> wizard renders Bot Token, Signing Secret, and Listen Policy fields.
3. "Test Connection" calls `auth.test` and shows success/failure.
4. On save, config is encrypted and stored.
5. Instance detail page shows status, config (secrets masked), and test button.

---

## Scoped Required Slack App Permissions

MVP bot token scopes:

| Scope | Why |
|-------|-----|
| `chat:write` | Post and update messages |
| `channels:history` | Read messages in public channels |
| `groups:history` | Read messages in private channels |
| `im:history` | Read DMs (optional) |
| `mpim:history` | Read group DMs (optional) |
| `reactions:write` | Add/remove emoji reactions |
| `channels:read` | List channels for validation |

Event subscriptions:
- `message.channels` — messages in public channels
- `message.groups` — messages in private channels
- `message.im` — DMs (optional)
- `app_mention` — when bot is @mentioned

---

## Receipt Trail

Every Slack interaction produces receipts through the existing work item pipeline:

- **Inbound receipt:** Work item with `source: 'slack'`, `source_ref: 'slack:{channel}:{ts}'`, `idempotencyKey: 'slack:{event_id}'`
- **Processing receipt:** Inference calls, spans, and cost entries (existing pipeline)
- **Outbound receipt:** `PostResponseResult` with `providerRef: '{channel}:{message_ts}'`

---

## Testing Plan

1. **Unit tests** for `verify-request.ts`, `parse-webhook.ts`, `format.ts` (same pattern as existing handler tests).
2. **Integration test script** (`scripts/e2e/send-slack-webhook.mjs`) that posts a realistic Slack event payload to the local webhook endpoint.
3. **Manual test:** Install the Slack app in a test workspace, add the bot to a channel, send a message, verify the agent responds in-thread.

---

## File Change Summary

| Action | Path |
|--------|------|
| **New package** | `packages/connectors-slack/` (6 source files + package.json + tsconfig) |
| **New** | `packages/plugin-handlers/src/slack/index.ts` |
| **New** | `packages/plugin-handlers/src/slack/config.ts` |
| **New** | `packages/plugin-handlers/src/slack/parse-webhook.ts` |
| **New** | `packages/plugin-handlers/src/slack/types.ts` |
| **New** | `packages/agent/src/integrations/slack.ts` |
| **New** | `scripts/e2e/send-slack-webhook.mjs` |
| **Edit** | `packages/plugin-handlers/src/registry.ts` — register slackHandler |
| **Edit** | `packages/agent/src/runner.ts` — import slack integration |
| **Edit** | `apps/web/app/api/webhooks/plugins/[type]/[instanceId]/route.ts` — handle challenge response |
| **Edit** | `pnpm-workspace.yaml` — add connectors-slack |

No database changes. No new routes. No custom admin UI.
