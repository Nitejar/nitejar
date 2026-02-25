# Sprite session manual e2e scripts

These scripts exercise sprite session behavior directly (no model inference required).

## Prereqs

```bash
export $(grep -v '^#' apps/web/.env | xargs)
export DATABASE_URL=$(pwd)/packages/database/data/nitejar.db
```

Pass sprite name as CLI arg, or set `SLOPBOT_TEST_SPRITE` / `SPRITE_NAME`.

## Scripts

### 1) Baseline session sanity

```bash
npx tsx packages/sprites/tests/e2e/session-manual.ts
```

### 2) Verify timeout-triggered session reset (no wedged shell)

```bash
npx tsx packages/sprites/tests/e2e/session-stuck-repro-manual.ts <sprite-name>
```

Expected signature:

- `exitCode: 124`
- timeout stderr includes `Session reset after timeout to avoid a wedged shell.`
- probing the stale handle returns `Session is closed`

### 3) Verify recovery paths

```bash
npx tsx packages/sprites/tests/e2e/session-stuck-recovery-manual.ts <sprite-name>
```

Checks:

- same session key re-fetch recreates and succeeds
- fresh session key succeeds
- stateless `spriteExecHttp` succeeds

### 4) Diagnose interrupt-based in-place recovery

```bash
npx tsx packages/sprites/tests/e2e/session-timeout-interrupt-diagnostic-manual.ts <sprite-name>
```

Optional strict mode:

```bash
npx tsx packages/sprites/tests/e2e/session-timeout-interrupt-diagnostic-manual.ts <sprite-name> --require-recovery
```

This reports whether timeout handling recovered in-place or used reset fallback.

### 5) POC: reset fallback + last-known-cwd restore

```bash
npx tsx packages/sprites/tests/e2e/session-timeout-cwd-restore-poc-manual.ts <sprite-name>
```

Checks:

- timeout causes reset fallback
- same session key re-fetch creates a new session
- recreated session starts at provided recovered cwd

### 6) Slack deterministic trace harness (steer mode)

Runs synthetic signed Slack webhook events against the local dev server, then grades outcomes from DB receipts (`jobs`, `work_items`, `messages`, `inference_calls`, `spans`, queue/dispatch tables).

This harness is a diagnostic workflow, not a required deterministic gate for CI.
Use unit/integration Slack tests as the primary correctness signal.

```bash
# Optional override if auto-detection cannot find a recent Slack channel.
export SLOPBOT_SLACK_CHANNEL_ID=C12345678

# Optional if dev server is not on :3000.
export SLOPBOT_WEB_BASE_URL=http://localhost:3000

npx tsx packages/sprites/tests/e2e/slack-deterministic.spec.ts
```

If Slack manifest scopes change, reinstall/re-authorize the Slack app before running this harness so scope failures are not misclassified as logic regressions.

Review-only mode (inspect recent Slack failures without sending new messages):

```bash
npx tsx packages/sprites/tests/e2e/slack-deterministic.spec.ts --review-only
```
