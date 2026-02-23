# Plan: Google Drive Plugin

**Prerequisites:** `03-google-oauth.md` must be completed first.
**Estimated new files:** 3
**Estimated modified files:** 0-1

## Architecture Decisions

- Handler relies on OAuth connection (no separate secrets).
- Tools are prefixed `drive_`.
- Google Docs plugin (`06-google-docs.md`) depends on this Drive client for search/export operations.
- Watch/sync workers are deferred to Phase 3+ per tech spec.

---

## Implementation

### New files

**`packages/plugin-handlers/src/google-drive/index.ts`** — `PluginHandler` implementation

Handler config fields:
- No secrets — relies on OAuth connection
- Optional: `rootFolderId` (text) — restrict operations to a folder subtree

`testConnection`: Verify OAuth connection exists, make a test `files.list` call (limit 1)

**`packages/plugin-handlers/src/google-drive/types.ts`**
- `GoogleDriveConfig` — handler config shape
- Google Drive API response types (File, FileList, Permission)

**`packages/plugin-handlers/src/google-drive/client.ts`**

Base URL: `https://www.googleapis.com/drive/v3`
Upload URL: `https://www.googleapis.com/upload/drive/v3`

Methods:
- `searchFiles(token, query, params?)` — GET `/files` with `q` parameter (Drive search syntax)
- `listFiles(token, folderId?, params?)` — GET `/files` with parent filter
- `getFile(token, fileId, fields?)` — GET `/files/{fileId}`
- `getFileContent(token, fileId)` — GET `/files/{fileId}?alt=media` (download)
- `exportFile(token, fileId, mimeType)` — GET `/files/{fileId}/export` (for Google Docs/Sheets/Slides)
- `createFile(token, metadata, content?, mimeType?)` — POST `/files` (multipart upload)
- `createFolder(token, name, parentId?)` — POST `/files` with `mimeType: 'application/vnd.google-apps.folder'`
- `updateFile(token, fileId, metadata?, content?, mimeType?)` — PATCH `/files/{fileId}`
- `deleteFile(token, fileId)` — DELETE `/files/{fileId}`

### Integration provider

**`packages/agent/src/integrations/google-drive.ts`**

Tools (all prefixed `drive_`):

| Tool | Parameters | Description |
|---|---|---|
| `drive_search` | `query`, `max_results?` | Search files using Drive query syntax |
| `drive_list` | `folder_id?`, `max_results?` | List files in a folder |
| `drive_get` | `file_id` | Get file metadata |
| `drive_download` | `file_id`, `output_path?` | Download file content (or export Google Docs format) |
| `drive_upload` | `name`, `content`, `mime_type?`, `folder_id?` | Upload a new file |
| `drive_create_folder` | `name`, `parent_id?` | Create a folder |
| `drive_update` | `file_id`, `name?`, `content?`, `mime_type?` | Update file metadata or content |
| `drive_delete` | `file_id` | Move file to trash |

System prompt section: Drive-specific context (query syntax examples like `name contains 'report' and mimeType = 'application/pdf'`, folder hierarchy, Google Docs MIME types).

Self-registration in integration registry.

### Pattern

- Handler: `packages/plugin-handlers/src/telegram/`
- Integration: `packages/agent/src/integrations/telegram.ts`

---

## Testing

**File:** `packages/plugin-handlers/src/google-drive/client.test.ts`

- File search with query parameter
- File list with folder filter
- File download (binary content)
- Google Docs export (to text/plain or application/pdf)
- File upload (multipart)
- Folder creation
- Error handling (403 forbidden, 404 not found)

## Verification

1. `pnpm format && pnpm lint && pnpm run typecheck` — zero errors
2. `pnpm test` — all tests pass
3. With real OAuth: search files, upload a test file, download it, verify content matches

## Required OAuth Scopes

```
https://www.googleapis.com/auth/drive
```

Defined in `GOOGLE_SCOPE_TEMPLATES.drive` from `03-google-oauth.md`.

## Note for Google Docs Plan

The `client.ts` in this package exports `exportFile()` which the Google Docs plugin will use for exporting documents. Ensure the client is importable from `@nitejar/plugin-handlers/google-drive/client` or a shared path.
