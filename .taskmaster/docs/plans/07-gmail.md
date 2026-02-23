# Plan: Gmail Plugin

**Prerequisites:** `03-google-oauth.md` must be completed first.
**Estimated new files:** 3
**Estimated modified files:** 0-1

## Architecture Decisions

- Gmail API for message operations (search, read, send, labels).
- Push notifications (watch) deferred to Phase 3+ per tech spec.
- Email sending uses RFC 2822 formatted messages, base64url encoded.
- Attachment handling downloads to sprite filesystem.

---

## Implementation

### New files

**`packages/plugin-handlers/src/gmail/index.ts`** — `PluginHandler` implementation

Handler config fields:
- No secrets — relies on OAuth connection
- Optional: `defaultSendAs` (text) — email address to send from (if the connected account has aliases)

`testConnection`: Verify OAuth connection exists, make a test `users.getProfile` call

**`packages/plugin-handlers/src/gmail/types.ts`**
- `GmailConfig` — handler config shape
- Gmail API types (Message, MessagePart, Label, Thread)

**`packages/plugin-handlers/src/gmail/client.ts`**

Base URL: `https://gmail.googleapis.com/gmail/v1`

Methods:
- `searchMessages(token, query, maxResults?)` — GET `/users/me/messages` with `q` parameter
- `getMessage(token, messageId, format?)` — GET `/users/me/messages/{id}` (format: 'full', 'metadata', 'raw')
- `getAttachment(token, messageId, attachmentId)` — GET `/users/me/messages/{id}/attachments/{attachmentId}`
- `sendMessage(token, raw)` — POST `/users/me/messages/send` (base64url-encoded RFC 2822)
- `listLabels(token)` — GET `/users/me/labels`
- `getProfile(token)` — GET `/users/me/profile`

Helper functions:
- `buildRawMessage(to, subject, body, cc?, bcc?, replyTo?)` — build RFC 2822 message string, base64url encode
- `parseMessageParts(payload)` — recursive extraction of text/html body and attachments from MIME parts
- `decodeBase64Url(data)` — Gmail uses URL-safe base64

### Integration provider

**`packages/agent/src/integrations/gmail.ts`**

Tools (all prefixed `gmail_`):

| Tool | Parameters | Description |
|---|---|---|
| `gmail_search` | `query`, `max_results?` | Search emails using Gmail query syntax |
| `gmail_get_message` | `message_id`, `format?` | Get a single email (full content) |
| `gmail_get_attachment` | `message_id`, `attachment_id`, `output_path?` | Download an attachment |
| `gmail_send` | `to`, `subject`, `body`, `cc?`, `bcc?`, `reply_to?`, `thread_id?` | Send an email |
| `gmail_list_labels` | — | List all labels in the mailbox |

**`gmail_search` flow:**
1. Call `searchMessages` with Gmail query syntax
2. For each result, fetch metadata (subject, from, date, snippet)
3. Return list with message IDs for follow-up `gmail_get_message`

**`gmail_get_message` flow:**
1. Fetch full message
2. Parse MIME parts to extract body text + attachment metadata
3. Return structured message (from, to, subject, date, body, attachment list)

**`gmail_send` flow:**
1. Build RFC 2822 message via `buildRawMessage`
2. Base64url encode
3. POST to send endpoint
4. If `thread_id` provided, include it to thread the reply
5. Return sent message ID

System prompt section: Gmail-specific context (search query syntax examples like `from:alice subject:report after:2026/01/01`, label names, threading behavior, attachment handling).

Self-registration in integration registry.

### Pattern

- Handler: `packages/plugin-handlers/src/telegram/`
- Integration: `packages/agent/src/integrations/telegram.ts`

---

## Testing

**File:** `packages/plugin-handlers/src/gmail/client.test.ts`

- Message search with query
- Message retrieval and MIME parsing (multipart/mixed with attachments)
- RFC 2822 message building
- Base64url encoding/decoding
- Attachment download
- Send message (mock API)
- Error handling (401 → token refresh, 404)

## Verification

1. `pnpm format && pnpm lint && pnpm run typecheck` — zero errors
2. `pnpm test` — all tests pass
3. With real OAuth: search for recent emails, read one, verify content parsed correctly
4. Send a test email (to self), verify it arrives

## Required OAuth Scopes

```
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/gmail.send
```

Defined in `GOOGLE_SCOPE_TEMPLATES.gmail` from `03-google-oauth.md`.

## Security Notes

- Email sending is a sensitive operation. The system prompt should include clear guidance about confirming recipients before sending.
- Attachment downloads go to sprite filesystem (sandboxed per agent).
- No auto-forwarding or rule creation in this plan (future scope).
