# Notion Plugin Implementation Plan

## Goal

Let agents read, write, and query Notion workspaces — pages, blocks, and databases. Tool-driven CRUD first (no inbound webhooks in MVP). Receipts are page URLs, block IDs, and database row references.

---

## Architecture Overview

Same three-layer pattern as Telegram/GitHub/Slack:

| Layer | Package | Purpose |
|-------|---------|---------|
| **Connector** | `packages/connectors-notion/` | Notion REST API client, auth, response normalization |
| **Plugin handler** | `packages/plugin-handlers/src/notion/` | `PluginHandler` implementation: config, (future) webhook parsing, response posting |
| **Integration provider** | `packages/agent/src/integrations/notion.ts` | Agent tools + system prompt sections |

### Key difference from Slack/Telegram

Notion is **document-first, not chat-first.** There's no real-time inbound message stream in MVP. Agents use Notion as a knowledge store — they search, read, create, and update pages/databases as part of their work. The plugin handler exists for config management, `testConnection`, and future webhook support, but `parseWebhook` returns `{ shouldProcess: false }` until Phase 2.

Response mode: **`final`** (same as GitHub). There's no streaming UX for document writes.

---

## Phase 1: Connector Package (`packages/connectors-notion/`)

New workspace package. Wraps the Notion REST API directly (no `@notionhq/client` SDK — it adds weight and we only need a handful of endpoints).

### Files

```
packages/connectors-notion/
  src/
    index.ts              # Re-exports
    notion-client.ts      # Authenticated REST client with Notion-Version header
    pages.ts              # Create, retrieve, update pages
    blocks.ts             # Get block children, append block children
    databases.ts          # Query database, create database entry
    search.ts             # Search endpoint
    format.ts             # Markdown <-> Notion block conversion helpers
    types.ts              # Notion API type definitions (pages, blocks, properties)
  package.json
  tsconfig.json
```

### `notion-client.ts`

```typescript
export function createNotionClient(config: { token: string; notionVersion?: string }): NotionClient

// NotionClient handles:
//   - Bearer auth header on every request
//   - Notion-Version header (default: '2022-06-28')
//   - 429 rate limit handling with Retry-After
//   - Typed NotionApiError for error responses
```

All methods return typed responses. Rate limit errors throw `NotionRateLimitError` with `retryAfterMs`.

### API surface (MVP)

| Method | Notion endpoint | Purpose |
|--------|-----------------|---------|
| `search(query, filter?)` | `POST /v1/search` | Find pages and databases |
| `getPage(pageId)` | `GET /v1/pages/{id}` | Retrieve page properties |
| `createPage(parent, properties, children?)` | `POST /v1/pages` | Create a page |
| `updatePage(pageId, properties)` | `PATCH /v1/pages/{id}` | Update page properties |
| `getBlockChildren(blockId, cursor?)` | `GET /v1/blocks/{id}/children` | Read page content |
| `appendBlockChildren(blockId, children)` | `PATCH /v1/blocks/{id}/children` | Append content to a page |
| `queryDatabase(databaseId, filter?, sort?, cursor?)` | `POST /v1/databases/{id}/query` | Query a database |
| `createDatabaseEntry(databaseId, properties)` | `POST /v1/pages` (with database_id parent) | Add a row to a database |

### `format.ts`

Bidirectional conversion between Markdown and Notion blocks. MVP scope:

- **Markdown -> Notion blocks:** Headings, paragraphs, bulleted/numbered lists, code blocks, bold/italic/links. Used when agents write content.
- **Notion blocks -> Markdown:** Same block types back to readable Markdown. Used when agents read pages and need the content in their context.

This keeps the agent interface text-based while the Notion API stays block-based.

---

## Phase 2: Plugin Handler (`packages/plugin-handlers/src/notion/`)

### Files

```
packages/plugin-handlers/src/notion/
  index.ts          # PluginHandler export
  config.ts         # Zod schema, NotionConfig type, sensitive fields
```

### Config schema

```typescript
interface NotionConfig {
  token: string                // Internal integration token (required)
  workspaceName?: string       // For display purposes (populated on testConnection)
}

const NOTION_SENSITIVE_FIELDS = ['token'] as const
```

### Handler definition

```typescript
export const notionHandler: PluginHandler<NotionConfig> = {
  type: 'notion',
  displayName: 'Notion',
  description: 'Read and write Notion pages, blocks, and databases.',
  icon: 'brand-notion',
  category: 'knowledge',
  sensitiveFields: [...NOTION_SENSITIVE_FIELDS],
  responseMode: 'final',

  setupConfig: {
    fields: [
      { key: 'token', label: 'Integration Token', type: 'password', required: true,
        placeholder: 'ntn_...', helpText: 'Internal integration token from notion.so/my-integrations.' },
    ],
    credentialHelpUrl: 'https://www.notion.so/my-integrations',
    credentialHelpLabel: 'Create an integration',
    supportsTestBeforeSave: true,
  },

  validateConfig(config) { /* zod parse */ },

  async parseWebhook(_request, _pluginInstance) {
    // No inbound events in MVP
    return { shouldProcess: false }
  },

  async postResponse(_pluginInstance, _workItemId, _content, _responseContext) {
    // Notion is tool-driven, not response-driven
    // Agents write directly via tools, not through postResponse
    return { success: true, outcome: 'sent' }
  },

  async testConnection(config) {
    // Call GET /v1/users/me to verify token
    // Return workspace name for display
  },
}
```

### Registration

Add to `packages/plugin-handlers/src/registry.ts`:
```typescript
pluginHandlerRegistry.register(notionHandler)
```

### Why `postResponse` is a no-op

Unlike Telegram/Slack where the agent's final answer gets posted back to a chat, Notion interactions are tool-driven. The agent searches, reads, and writes using tools during its run. There's no "post the response to Notion" step at the end. The handler still satisfies the interface — it just doesn't do delivery work.

---

## Phase 3: Integration Provider (`packages/agent/src/integrations/notion.ts`)

This is where the real work happens. The integration provider contributes tools that let agents interact with Notion during their runs.

### Tools

| Tool | Description | Key params |
|------|-------------|------------|
| `notion_search` | Search for pages and databases by title | `query`, `filter` (page or database) |
| `notion_get_page` | Read a page's properties and content | `page_id` |
| `notion_create_page` | Create a new page | `parent_id`, `title`, `content` (markdown) |
| `notion_update_page` | Update a page's properties | `page_id`, `properties` |
| `notion_append_content` | Append content blocks to a page | `page_id`, `content` (markdown) |
| `notion_query_database` | Query a database with filters and sorts | `database_id`, `filter?`, `sort?` |
| `notion_add_database_entry` | Add a row to a database | `database_id`, `properties` |

### Tool design principles

- **Markdown in, Markdown out.** Agents write Markdown; tools convert to/from Notion blocks internally using `format.ts`. Agents never see raw block JSON.
- **Page content is returned as Markdown.** When reading a page, `notion_get_page` fetches block children and converts to readable Markdown, truncated if necessary.
- **Database queries return structured results.** `notion_query_database` returns rows as objects with property names as keys, not raw Notion property structures.
- **Tools resolve config from plugin instance.** Same pattern as Telegram tools — look up the plugin instance for the current agent, decrypt config, create client.

### Tool handler pattern

```typescript
const notionSearchHandler: ToolHandler = async (input, context) => {
  const client = await resolveNotionClient(context.pluginInstanceId)
  if (!client) return { success: false, error: 'Notion not configured.' }

  const results = await client.search(input.query, input.filter)
  // Normalize results to simple { id, title, type, url } objects
  return { success: true, output: JSON.stringify(results) }
}
```

### System prompt section

Tell the agent:
- It has access to a Notion workspace.
- Pages and databases that have been shared with the integration are accessible.
- Use `notion_search` to find content before creating duplicates.
- When creating pages, prefer attaching them to existing parent pages rather than creating top-level pages.
- Database entries use property names, not property IDs.

### Registration

Add import to `packages/agent/src/runner.ts`:
```typescript
import './integrations/notion'
```

---

## Phase 4 (Follow-on): Notion Webhooks

Not in MVP, but the handler is structured to support it. When ready:

1. Add `webhookSecret` to config schema and sensitive fields.
2. Implement `parseWebhook` to verify `X-Notion-Signature`, parse event envelope, and build work items for page/database change events.
3. Support event types: `page.content_updated`, `page.properties_updated`, `page.created`, `database.row_created`, `database.row_updated`.
4. Session key pattern: `notion:{page_id}` or `notion:db:{database_id}:{row_id}`.

---

## Phase 5 (Follow-on): OAuth

Not in MVP. When ready:

1. Add `clientId`, `clientSecret`, `redirectUri` to config.
2. Add `usesRedirectFlow: true` to setupConfig (same pattern as GitHub).
3. Create callback page at `apps/web/app/admin/plugins/notion/callback/`.
4. Exchange authorization code for access token via `/v1/oauth/token`.
5. Support token refresh via `/v1/oauth/token` with refresh token.

---

## Admin UI

No custom UI work needed in MVP. The `setupConfig` drives the existing install wizard. Admin sees:

1. "Notion" card in plugin catalog (brand-notion icon, "knowledge" category).
2. Install wizard with one field: Integration Token.
3. "Test Connection" verifies the token and shows the workspace name.
4. Instance detail page shows status and masked config.

---

## Receipt Trail

Notion tool calls produce receipts through the existing pipeline:

- **Tool call receipts:** Each tool invocation is logged as part of the inference call trace (spans).
- **Notion-side receipts:** Tools return page IDs and URLs that appear in the agent's response and work item log.
- **Cost receipts:** Inference calls during the run are tracked as usual.

The key difference from chat plugins: receipts point to Notion artifacts (page URLs, database row IDs) rather than message timestamps.

---

## Testing Plan

1. **Unit tests** for `notion-client.ts` (mock HTTP), `format.ts` (markdown <-> blocks), `config.ts` (validation).
2. **Integration test:** Create a test Notion workspace with a shared page and database. Run an agent with Notion tools enabled, verify it can search, read, write.
3. **Manual test:** Install plugin in admin UI, add integration token, verify test connection, assign to an agent, trigger a work item that asks the agent to "create a page in Notion summarizing X", verify the page appears.

---

## File Change Summary

| Action | Path |
|--------|------|
| **New package** | `packages/connectors-notion/` (8 source files + package.json + tsconfig) |
| **New** | `packages/plugin-handlers/src/notion/index.ts` |
| **New** | `packages/plugin-handlers/src/notion/config.ts` |
| **New** | `packages/agent/src/integrations/notion.ts` |
| **Edit** | `packages/plugin-handlers/src/registry.ts` — register notionHandler |
| **Edit** | `packages/agent/src/runner.ts` — import notion integration |
| **Edit** | `pnpm-workspace.yaml` — add connectors-notion |

No database changes. No new routes. No custom admin UI.

---

## Open Questions

1. **Block conversion depth.** How many nested block types do we support in `format.ts` for MVP? Recommendation: headings, paragraphs, lists, code, bold/italic/links. Skip: tables, toggles, embeds, synced blocks, callouts.
2. **Page content truncation.** Long pages could blow up agent context. Recommendation: truncate at ~4000 tokens with a "... (truncated, use notion_get_page with start_cursor for more)" hint.
3. **Database property type coverage.** Which Notion property types do we normalize for MVP? Recommendation: title, rich_text, number, select, multi_select, date, checkbox, url, email, phone. Skip: formula, rollup, relation, people, files.
