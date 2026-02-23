# Plan: Discord Plugin

**Prerequisites:** None — can start immediately.
**Estimated new files:** 6
**Estimated modified files:** 2

## Architecture Decisions

- Discord is a full plugin handler + integration provider (like Telegram/GitHub).
- **Deferred interactions:** ACK within 3 seconds (type 5 `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE`), then post agent response as follow-up. `responseMode: 'final'`.
- **Ed25519 signature verification** — Discord uses Ed25519, not HMAC like Slack.
- Guild-scoped slash command registration in `testConnection`.

---

## Step 1: Discord Plugin Handler

### New files

**`packages/plugin-handlers/src/discord/index.ts`** — `PluginHandler` implementation

Handler config fields:
- `applicationId` (text)
- `publicKey` (text)
- `botToken` (text, sensitive)
- `guildId` (text)

Session key: `discord:{guild_id}:{channel_id}`
Idempotency key: `discord:{interaction_id}`
Response mode: `final`

**`packages/plugin-handlers/src/discord/types.ts`**
- `DiscordConfig` — handler config shape
- `DiscordResponseContext` — response context for follow-ups
- Discord API interaction types (PING, APPLICATION_COMMAND, etc.)

**`packages/plugin-handlers/src/discord/webhook.ts`**
- Ed25519 signature verification (use `tweetnacl` or Node crypto `sign.detached.verify`)
- Interaction parsing: distinguish PING (respond with type 1), APPLICATION_COMMAND (defer + dispatch), MESSAGE_COMPONENT (if needed later)
- PING handler returns `{ type: 1 }` immediately (Discord verification)
- APPLICATION_COMMAND handler: respond with type 5 (deferred), then create work item for agent dispatch

**`packages/plugin-handlers/src/discord/client.ts`**
- `sendFollowUpMessage(applicationId, interactionToken, content)` — POST to `/webhooks/{app_id}/{token}`
- `editOriginalResponse(applicationId, interactionToken, content)` — PATCH to `/webhooks/{app_id}/{token}/messages/@original`
- `registerGuildCommands(applicationId, botToken, guildId, commands)` — PUT to `/applications/{app_id}/guilds/{guild_id}/commands`
- `sendChannelMessage(botToken, channelId, content)` — POST to `/channels/{channel_id}/messages`
- `getChannelMessages(botToken, channelId, limit?)` — GET from `/channels/{channel_id}/messages`

### Modified files

- `packages/plugin-handlers/src/index.ts` — register Discord handler in the handler map

### Key implementation details

**Webhook flow:**
1. Discord sends interaction to `/api/webhooks/discord/{integration_id}`
2. Verify Ed25519 signature using `publicKey` from config
3. If PING → respond `{ type: 1 }`
4. If APPLICATION_COMMAND → respond `{ type: 5 }` (deferred ACK), then create work item
5. Agent runs, produces response
6. Handler posts response via follow-up endpoint using interaction token

**Slash command registration:**
- `testConnection` should register a `/ask` (or configurable) slash command on the guild
- Uses PUT `/applications/{app_id}/guilds/{guild_id}/commands` with bot token

---

## Step 2: Discord Integration Provider

### New file

**`packages/agent/src/integrations/discord.ts`**

Tools:
- `send_discord_message(channel_id, content, reply_to?)` — post a message to a channel
- `read_discord_channel(channel_id, limit?)` — read recent messages from a channel

System prompt section: Discord-specific formatting rules:
- Discord uses a subset of Markdown (bold, italic, code, links)
- Mention syntax: `<@user_id>`, `<#channel_id>`, `<@&role_id>`
- Embed limits: 4096 chars for description, 256 chars for title
- Message limit: 2000 characters (split longer responses)

Self-registration in the integration registry (same pattern as Telegram).

### Modified files

- None beyond the self-registration pattern (file imports itself into registry)

### Pattern

`packages/agent/src/integrations/telegram.ts` — tools + prompt sections + self-registration in registry

---

## Testing

**File:** `packages/plugin-handlers/src/discord/webhook.test.ts`

- Ed25519 signature verification (valid + invalid signatures)
- PING interaction → type 1 response
- APPLICATION_COMMAND interaction → type 5 deferred response + work item creation
- Follow-up message posting
- Slash command registration

**Integration test:**
- Synthetic interaction webhook → work item → agent dispatch → follow-up response
- Verify idempotency key prevents duplicate processing

## Verification

1. `pnpm format && pnpm lint && pnpm run typecheck` — zero errors
2. `pnpm test` — all tests pass
3. Send synthetic Discord interaction to webhook endpoint
4. Verify work item created with correct session key
5. Verify follow-up response posted (mock Discord API)
