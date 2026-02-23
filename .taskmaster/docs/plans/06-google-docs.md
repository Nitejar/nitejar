# Plan: Google Docs Plugin

**Prerequisites:** `03-google-oauth.md` AND `05-google-drive.md` must be completed first.
**Estimated new files:** 3
**Estimated modified files:** 0-1

## Architecture Decisions

- Google Docs API handles document structure (create, read, batch update).
- Search and export operations use the Drive client from `05-google-drive.md`.
- Docs API uses a request-based batch update model (insertText, deleteContentRange, etc.) — not direct content replacement.
- For simplicity, the `docs_get` tool returns plain text (exported via Drive), not the raw Docs JSON structure. The raw structure is only used internally for batch updates.

---

## Implementation

### New files

**`packages/plugin-handlers/src/google-docs/index.ts`** — `PluginHandler` implementation

Handler config fields:
- No secrets — relies on OAuth connection
- Optional: `defaultFolderId` (text) — where to create new docs

`testConnection`: Verify OAuth connection exists, make a test Drive `files.list` call filtered to `mimeType = 'application/vnd.google-apps.document'`

**`packages/plugin-handlers/src/google-docs/types.ts`**
- `GoogleDocsConfig` — handler config shape
- Google Docs API types (Document, Request, BatchUpdateResponse)

**`packages/plugin-handlers/src/google-docs/client.ts`**

Base URL: `https://docs.googleapis.com/v1`

Methods:
- `createDocument(token, title)` — POST `/documents`
- `getDocument(token, documentId)` — GET `/documents/{documentId}` (returns full JSON structure)
- `batchUpdate(token, documentId, requests)` — POST `/documents/{documentId}:batchUpdate`

For content reading and search, use the Drive client:
- `driveClient.exportFile(token, fileId, 'text/plain')` — export as plain text
- `driveClient.searchFiles(token, query)` — search for docs

### Integration provider

**`packages/agent/src/integrations/google-docs.ts`**

Tools (all prefixed `docs_`):

| Tool | Parameters | Description |
|---|---|---|
| `docs_create` | `title`, `content?`, `folder_id?` | Create a new Google Doc, optionally with initial content |
| `docs_get` | `document_id` | Get document content as plain text |
| `docs_batch_update` | `document_id`, `requests` | Apply batch update requests (insertText, deleteContentRange, replaceAllText, etc.) |

**`docs_create` flow:**
1. Create empty doc via Docs API
2. If `content` provided, insert text via `batchUpdate` with `insertText` request
3. If `folder_id` provided, move file to folder via Drive API
4. Return document ID + URL

**`docs_get` flow:**
1. Export document as plain text via Drive `exportFile()`
2. Return text content + document metadata (title, last modified)

**`docs_batch_update` flow:**
1. Validate requests array
2. Forward to Docs API `batchUpdate`
3. Return success + reply from API

Common batch update request examples (for system prompt):
```json
// Insert text at index
{ "insertText": { "location": { "index": 1 }, "text": "Hello world" } }

// Replace all occurrences
{ "replaceAllText": { "containsText": { "text": "old", "matchCase": true }, "replaceText": "new" } }

// Delete range
{ "deleteContentRange": { "range": { "startIndex": 1, "endIndex": 10 } } }
```

System prompt section: Docs-specific context (batch update request format, index-based editing, how content indices work in Google Docs).

Self-registration in integration registry.

### Pattern

- Handler: `packages/plugin-handlers/src/telegram/`
- Integration: `packages/agent/src/integrations/telegram.ts`

---

## Testing

**File:** `packages/plugin-handlers/src/google-docs/client.test.ts`

- Document creation
- Document retrieval (raw JSON + plain text export)
- Batch update with insertText
- Batch update with replaceAllText
- Error handling (404, permission denied)

## Verification

1. `pnpm format && pnpm lint && pnpm run typecheck` — zero errors
2. `pnpm test` — all tests pass
3. With real OAuth: create a doc, write content, read it back, verify content matches

## Required OAuth Scopes

```
https://www.googleapis.com/auth/documents
https://www.googleapis.com/auth/drive.readonly
```

Defined in `GOOGLE_SCOPE_TEMPLATES.docs` from `03-google-oauth.md`. The `drive.readonly` scope is needed for export/search operations.
