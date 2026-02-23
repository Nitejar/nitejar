---
name: Nitejar Development
description: This skill should be used when working on nitejar development tasks like "run tests", "test sprites", "run migrations", "check database", "start dev server", "debug agent", "set up telegram", "check logs", or any nitejar-specific development workflow.
version: 0.1.0
---

# Nitejar Development Skill

Workflows and references for developing nitejar.

## Quick Commands

### Dev Server

```bash
pnpm dev
```

Runs on port 3000 (or 3002 if busy).

### Type Checks

```bash
pnpm run typecheck
```

### Build

```bash
pnpm --filter @nitejar/web build
```

### Migrations

```bash
pnpm --filter @nitejar/database db:migrate
```

### Source Env Vars (for scripts)

```bash
export $(grep -v '^#' apps/web/.env | xargs)
```

## Testing

### Sprite Session E2E Tests

**Test file:** `packages/sprites/tests/e2e/session-manual.ts`

```bash
export $(grep -v '^#' apps/web/.env | xargs) && \
export DATABASE_URL=$(pwd)/packages/database/data/nitejar.db && \
npx tsx packages/sprites/tests/e2e/session-manual.ts
```

Tests: session creation, shell state persistence (cd, env vars), exit codes, multi-job persistence.

### Session Context Testing

1. Send message with memorable info ("My name is Josh")
2. Wait for response
3. Send follow-up ("What's my name?")
4. Agent should recall from session history

### Database Inspection

```bash
# Tables
sqlite3 packages/database/data/nitejar.db ".tables"

# Agents
sqlite3 packages/database/data/nitejar.db "SELECT id, name, status FROM agents;"

# Sprite sessions
sqlite3 packages/database/data/nitejar.db "SELECT id, session_key, agent_id, status FROM sprite_sessions ORDER BY created_at DESC LIMIT 10;"

# Recent messages
sqlite3 packages/database/data/nitejar.db "SELECT * FROM messages ORDER BY created_at DESC LIMIT 20;"

# Plugin instances
sqlite3 packages/database/data/nitejar.db "SELECT id, plugin_id, name, enabled FROM plugin_instances;"
```

## Telegram Plugin Instance

### Webhook Setup

The public URL is configured via `APP_BASE_URL` in `apps/web/.env`.

```bash
# Discover ngrok domain (if ngrok is running locally)
curl -s http://localhost:4040/api/tunnels | grep -o '"public_url":"[^"]*"' | head -1 | cut -d'"' -f4

# Or check env
grep APP_BASE_URL apps/web/.env

# Get bot token
sqlite3 packages/database/data/nitejar.db "SELECT json_extract(config_json, '$.botToken') FROM plugin_instances WHERE plugin_id='telegram';"

# Set webhook (replace variables)
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<APP_BASE_URL>/api/webhooks/plugins/telegram/<PLUGIN_INSTANCE_ID>"

# Verify
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

### Local Testing

1. Start ngrok: `ngrok http 3002` (use `--url=your-domain` for a stable domain)
2. Start dev server: `pnpm dev`
3. Set webhook to ngrok URL
4. Send message to bot

## Debugging

### Prompt Logging

1. Add `DEBUG_PROMPTS=true` to `apps/web/.env`
2. Restart dev server
3. View logs:

```bash
cat logs/prompts.jsonl | jq .
tail -f logs/prompts.jsonl | jq .
grep "job-id" logs/prompts.jsonl | jq .
```

Logs include: messages array, tools, model config, session turns count.

## Architecture

### Session Lifecycle

Sprite sessions are per-conversation (`session_key` + `agent_id`), not per-job:

- Shell state persists across jobs in same conversation
- Cleanup on conversation compaction or reset
- Table: `sprite_sessions`

### Package Structure

| Package                 | Purpose                                |
| ----------------------- | -------------------------------------- |
| `packages/database`     | Kysely ORM, migrations, repositories   |
| `packages/sprites`      | Session management, command execution  |
| `packages/agent`        | Runner, tools, session context, memory |
| `packages/plugin-handlers` | Telegram, GitHub webhook handlers   |
| `apps/web`              | Next.js app, API routes, admin UI      |

### Agent Config

Config stored as JSON in `agents.config`. Types in `packages/agent/src/types.ts`.

Adding config sections:

1. Add interface to `types.ts`
2. Add to `AgentConfig` interface
3. Add defaults in `config.ts`
4. Add validation in `config.ts`
5. Add to `mergeAgentConfig()`
6. Export from `index.ts`

### Admin UI Sections

Agent detail page components in `apps/web/app/admin/agents/[id]/`:

- `SoulSection.tsx` - Personality
- `ModelSection.tsx` - Model settings
- `MemorySection.tsx` - Memory management
- `SessionSection.tsx` - Session settings

Each section manages own state, calls `/api/agents/[id]/config` to save.

## Additional Resources

### Reference Files

- **`references/database.md`** - Schema, migrations, repository functions
