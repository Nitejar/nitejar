# Database Reference

## Local Dev Defaults

- Local SQLite DB: `packages/database/data/nitejar.db`
- App env file: `apps/web/.env`
- Migration runner: `packages/database/src/migrate.ts`
- Migration files: `packages/database/migrations/`

This repo treats the local DB as disposable for transactional/runtime data. It is fine to wipe work items, jobs, messages, spans, inference calls, or sprite session rows during local debugging. Do not casually destroy configuration data such as `agents`, `plugin_instances`, model catalog rows, or related assignment/config tables.

## Core Tables

| Table                    | Purpose |
| ------------------------ | ------- |
| `agents`                 | Agent identity, handle, and config |
| `plugin_instances`       | Configured plugin connections such as Telegram |
| `agent_plugin_instances` | Agent-to-plugin-instance assignments |
| `work_items`             | Incoming work units from sessions, plugins, or routines |
| `jobs`                   | Per-agent execution records for a work item |
| `messages`               | User/assistant/system conversation rows |
| `queue_messages`         | Queue receipts for routing and delivery |
| `run_dispatches`         | Dispatch receipts linking work items to runs/jobs |
| `agent_memories`         | Stored agent memories |
| `sprite_sessions`        | Persistent shell/session handles for sprites |
| `inference_calls`        | Model invocation receipts |
| `spans`                  | Trace spans for execution visibility |

## Useful Queries

```bash
DB=packages/database/data/nitejar.db

sqlite3 -header -column "$DB" "SELECT id, name, handle, status FROM agents ORDER BY created_at DESC LIMIT 20;"
sqlite3 -header -column "$DB" "SELECT id, plugin_id, name, enabled FROM plugin_instances ORDER BY created_at DESC LIMIT 20;"
sqlite3 -header -column "$DB" "SELECT agent_id, plugin_instance_id, created_at FROM agent_plugin_instances ORDER BY created_at DESC LIMIT 20;"
sqlite3 -header -column "$DB" "SELECT id, source, status, session_key, created_at FROM work_items ORDER BY created_at DESC LIMIT 20;"
sqlite3 -header -column "$DB" "SELECT id, work_item_id, agent_id, status, started_at, completed_at FROM jobs ORDER BY created_at DESC LIMIT 20;"
sqlite3 -header -column "$DB" "SELECT role, json_extract(content, '$.text') AS text, created_at FROM messages ORDER BY created_at DESC LIMIT 20;"
sqlite3 -header -column "$DB" "SELECT id, queue_key, status, work_item_id, dispatch_id FROM queue_messages ORDER BY created_at DESC LIMIT 20;"
sqlite3 -header -column "$DB" "SELECT id, work_item_id, queue_key, status, job_id FROM run_dispatches ORDER BY created_at DESC LIMIT 20;"
sqlite3 -header -column "$DB" "SELECT id, session_key, agent_id, status, created_at FROM sprite_sessions ORDER BY created_at DESC LIMIT 20;"
```

## Sprite Sessions

`sprite_sessions` tracks persistent shell state keyed by `session_key` plus `agent_id`.

Important columns:

- `sprite_name`: backing sprite/runtime name
- `session_id`: provider-side session identifier
- `session_key`: conversation or work-item session key
- `agent_id`: owning agent
- `status`: usually `active`, `closed`, or `error`
- `created_at`, `last_active_at`: lifecycle timestamps

Useful lookup:

```bash
sqlite3 -header -column "$DB" \
  "SELECT id, sprite_name, session_id, session_key, agent_id, status, last_active_at
   FROM sprite_sessions
   ORDER BY created_at DESC
   LIMIT 20;"
```

## Migrations

Run the normal local migration path with:

```bash
pnpm --filter @nitejar/database db:migrate
```

If the app reports a plugin-instance cutover mismatch, use the explicit cutover command mentioned in the error:

```bash
pnpm --filter @nitejar/database db:migrate:plugin-instances
```

## Repository Files

Common database repository entry points live in `packages/database/src/repositories/`, including:

- `agents.ts`
- `plugin-instances.ts`
- `work-items.ts`
- `jobs.ts`
- `messages.ts`
- `sprite-sessions.ts`
- `search-ops.ts`

Check `packages/database/src/types.ts` when you need the current table interfaces.
