# Database Reference

## Schema Overview

### Core Tables

| Table                | Purpose                             |
| -------------------- | ----------------------------------- |
| `agents`             | Agent definitions with config JSON  |
| `integrations`       | Telegram, GitHub, etc. configs      |
| `agent_integrations` | Many-to-many agent ↔ integration    |
| `work_items`         | Incoming messages/events to process |
| `jobs`               | Agent execution records             |
| `messages`           | Conversation messages per job       |
| `agent_memories`     | Long-term agent memories            |
| `session_summaries`  | Compacted conversation history      |
| `sprite_sessions`    | Shell session tracking              |
| `idempotency_keys`   | Deduplication                       |

### Sprite Sessions Schema

```sql
sprite_sessions (
  id TEXT PRIMARY KEY,
  sprite_name TEXT NOT NULL,
  session_id TEXT NOT NULL,      -- Sprites API session ID
  session_key TEXT NOT NULL,     -- Conversation session key
  agent_id TEXT NOT NULL,        -- Which agent owns this
  status TEXT DEFAULT 'active',  -- active, closed, error
  created_at INTEGER,
  last_active_at INTEGER
)
```

Indexes:

- `idx_sprite_sessions_session_key_agent` on `(session_key, agent_id)`
- `idx_sprite_sessions_status`
- `idx_sprite_sessions_sprite_name`

## Migrations

Migrations use Kysely schema builder in `packages/database/src/migrate.ts`.

### Adding New Tables

```typescript
await db.schema
  .createTable("table_name")
  .ifNotExists()
  .addColumn("id", "text", (col) => col.primaryKey())
  .addColumn("created_at", "integer", (col) => col.notNull().defaultTo(defaultTimestamp))
  .execute()
```

### Adding Columns to Existing Tables

Use `addColumnIfNotExists()` helper at end of `createTables()`:

```typescript
await addColumnIfNotExists(db, "table_name", "new_column", "text")
```

### Running Migrations

```bash
# For web app database
DATABASE_URL=$(pwd)/apps/web/data/nitejar.db pnpm --filter @nitejar/database db:migrate

# For postgres
DATABASE_URL=postgres://user:pass@host:5432/nitejar pnpm --filter @nitejar/database db:migrate
```

## Repository Pattern

Each table has a repository in `packages/database/src/repositories/`:

```
repositories/
├── agents.ts
├── integrations.ts
├── memories.ts
├── work-items.ts
├── jobs.ts
├── messages.ts
├── sessions.ts
├── sprite-sessions.ts
├── idempotency.ts
└── index.ts (re-exports all)
```

### Key Repository Functions

**sprite-sessions.ts:**

- `findSpriteSessionBySessionKey(sessionKey, agentId)` - Find active session for conversation
- `createSpriteSession(data)` - Create new session record
- `closeSpriteSession(id)` - Mark session as closed
- `closeSessionsForConversation(sessionKey, agentId)` - Close all sessions for a conversation
- `findStaleSessions(maxAgeSeconds)` - Find sessions to clean up

**messages.ts:**

- `listMessagesBySession(sessionKey, options)` - Get conversation history
- `findIdleSessions(idleThresholdSeconds)` - Find sessions needing compaction

## Types

Types defined in `packages/database/src/types.ts`:

```typescript
interface SpriteSessionTable {
  id: Generated<string>
  sprite_name: string
  session_id: string
  session_key: string
  agent_id: string
  status: Generated<string>
  created_at: Generated<number>
  last_active_at: Generated<number>
}
```

Update both the table interface and add to `Database` interface when adding tables.
