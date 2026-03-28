---
name: Nitejar Development
description: Use when working on Nitejar development tasks in this repo, including starting or reusing the dev server, running tests, running migrations, inspecting SQLite receipts, debugging agents, and exercising local Telegram or sprite e2e flows.
version: 0.2.0
---

# Nitejar Development

Use this skill for repo-specific development workflows in `nitejar/nitejar`.

## Start Here

- Apps read from `apps/web/.env`, not the repo root `.env`.
- Local dev DB lives at `packages/database/data/nitejar.db`.
- In the main checkout, prefer the existing `pnpm dev` server if one is already running.
- Only start a new `pnpm dev` server when no main-checkout server exists or when working from a git worktree.
- Do not run `pnpm build` while `pnpm dev` is running. Use `pnpm run typecheck` for normal verification during active dev.

## Verification Order

After meaningful code changes, run the relevant subset of these in order:

```bash
pnpm format
pnpm lint
pnpm run typecheck
pnpm test
pnpm test:coverage
```

If the schema changed, also run:

```bash
pnpm --filter @nitejar/database db:migrate
```

If you changed a publishable package (`@nitejar/cli`, `@nitejar/plugin-sdk`, or `create-nitejar-plugin`), add a changeset with:

```bash
pnpm changeset
```

## Common Commands

### Dev server

```bash
pnpm dev
```

Default local URL is `http://localhost:3000`.

### Typecheck without build

```bash
pnpm run typecheck
```

### Database migration

```bash
pnpm --filter @nitejar/database db:migrate
```

### One-off script env bootstrap

```bash
export $(grep -v '^#' apps/web/.env | xargs)
export DATABASE_URL=$(pwd)/packages/database/data/nitejar.db
```

## Quick Database Checks

Use `sqlite3 -header -column` for readable output:

```bash
DB=packages/database/data/nitejar.db

sqlite3 -header -column "$DB" "SELECT id, name, status, handle FROM agents ORDER BY created_at DESC LIMIT 20;"
sqlite3 -header -column "$DB" "SELECT id, plugin_id, name, enabled FROM plugin_instances ORDER BY created_at DESC LIMIT 20;"
sqlite3 -header -column "$DB" "SELECT agent_id, plugin_instance_id, created_at FROM agent_plugin_instances ORDER BY created_at DESC LIMIT 20;"
sqlite3 -header -column "$DB" "SELECT id, source, status, session_key, created_at FROM work_items ORDER BY created_at DESC LIMIT 20;"
sqlite3 -header -column "$DB" "SELECT id, work_item_id, agent_id, status, created_at FROM jobs ORDER BY created_at DESC LIMIT 20;"
sqlite3 -header -column "$DB" "SELECT role, json_extract(content, '$.text') AS text, created_at FROM messages ORDER BY created_at DESC LIMIT 20;"
sqlite3 -header -column "$DB" "SELECT id, session_key, agent_id, status, created_at FROM sprite_sessions ORDER BY created_at DESC LIMIT 20;"
```

For schema, migration, and repository notes, read `references/database.md`.

## Telegram Webhook E2E

Use this when you need a real local transport test with receipts.

1. Confirm the dev server is up on `http://localhost:3000`.
2. Find the Telegram plugin instance:

```bash
DB=packages/database/data/nitejar.db
sqlite3 -header -column "$DB" \
  "SELECT id, name, enabled FROM plugin_instances WHERE plugin_id='telegram';"
```

3. Send a Telegram-shaped webhook with the helper script:

```bash
node scripts/e2e/send-telegram-webhook.mjs \
  --plugin-instance-id "<plugin-instance-id>" \
  --chat-id "<chat-id>" \
  --thread-id "<thread-id>" \
  --text "Codex webhook smoke test E2E-$(date +%s)"
```

4. Inspect receipts in `work_items`, `jobs`, `messages`, `queue_messages`, and `run_dispatches`.

Use `docs/TELEGRAM_WEBHOOK_E2E.md` for the full repeatable workflow and pass/fail rubric.

## Sprite Session Harnesses

These scripts exercise sprite behavior directly and are the fastest way to debug session persistence or recovery.

Bootstrap env first:

```bash
export $(grep -v '^#' apps/web/.env | xargs)
export DATABASE_URL=$(pwd)/packages/database/data/nitejar.db
```

Main manual harnesses:

```bash
npx tsx packages/sprites/tests/e2e/session-manual.ts
npx tsx packages/sprites/tests/e2e/session-stuck-repro-manual.ts <sprite-name>
npx tsx packages/sprites/tests/e2e/session-stuck-recovery-manual.ts <sprite-name>
npx tsx packages/sprites/tests/e2e/session-timeout-interrupt-diagnostic-manual.ts <sprite-name>
npx tsx packages/sprites/tests/e2e/session-timeout-cwd-restore-poc-manual.ts <sprite-name>
```

Slack deterministic harness:

```bash
npx tsx packages/sprites/tests/e2e/slack-deterministic.spec.ts
```

Some harness env vars still use legacy `SLOPBOT_*` names. That is expected until those tests are renamed.

Use `packages/sprites/tests/e2e/README.md` for the latest harness details.

## Prompt And Triage Debugging

Enable prompt logging in `apps/web/.env`:

```bash
DEBUG_PROMPTS=true
DEBUG_TRIAGE=true
```

Then restart the dev server and inspect logs:

```bash
tail -f logs/prompts.jsonl
rg -n "<work-item-id>|<job-id>" logs/prompts.jsonl
```

`DEBUG_TRIAGE` emits triage receipts alongside prompt logging. Leave these off when you are not actively debugging.

## Task Tracking

This repo uses Task Master. For normal task flow:

```bash
task-master next
task-master show <id>
task-master update-subtask --id=<id> --prompt="implementation notes"
task-master set-status --id=<id> --status=done
```

Read `.taskmaster/CLAUDE.md` when you need the fuller Task Master workflow.

## References

- `references/database.md`
- `docs/TELEGRAM_WEBHOOK_E2E.md`
- `packages/sprites/tests/e2e/README.md`
- `.taskmaster/CLAUDE.md`
