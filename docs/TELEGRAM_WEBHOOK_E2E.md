# Telegram Webhook E2E (Local, Repeatable)

This runbook simulates a real Telegram webhook update and verifies agent replies using receipts in SQLite.

This runbook validates **Telegram transport + routing behavior**. It is not required for validating
in-app capability wiring (for example image generation, STT, TTS). Validate those from
`/settings/capabilities` and standard work item receipts.

For broader regression coverage (long-running runs, memory, security, and GitHub cross-surface tests), also use:

- `docs/AGENT_HOLISTIC_E2E_MATRIX.md`

## What this validates

- Webhook route accepts Telegram-shaped payloads.
- A `work_item` is created for the target chat/thread.
- Queue/dispatch runs for each assigned agent (triage is expected per assigned agent).
- Addressed agents respond; non-addressed agents may correctly pass with no assistant message.

## Prereqs

- Dev server running on `http://localhost:3000`
- Local DB at `packages/database/data/nitejar.db`
- Telegram plugin instance enabled and connected to at least one agent

## 0) Optional: check Telegram API health

This confirms the stored bot token is valid and shows webhook status.

```bash
DB=packages/database/data/nitejar.db
PLUGIN_INSTANCE_ID="<telegram-plugin-instance-id>"

BOT_TOKEN=$(sqlite3 "$DB" \
  "SELECT json_extract(config_json, '$.botToken')
   FROM plugin_instances
   WHERE id='${PLUGIN_INSTANCE_ID}';")

curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/getMe"
curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
```

`getWebhookInfo.last_error_date` is a Unix epoch; convert it with:

```bash
date -r <last_error_date> '+%Y-%m-%d %H:%M:%S %Z'
```

## 1) Find plugin instance + target chat/thread

```bash
DB=packages/database/data/nitejar.db

# Telegram plugin instances
sqlite3 -header -column "$DB" \
  "SELECT id, name, enabled FROM plugin_instances WHERE plugin_id='telegram';"

# Recent Telegram work items (use this to pick chat/thread IDs you want to target)
sqlite3 -header -column "$DB" \
  "SELECT id, plugin_instance_id, session_key, source_ref, title, created_at
   FROM work_items
   WHERE source='telegram'
   ORDER BY created_at DESC
   LIMIT 10;"
```

`session_key` format shows routing:

- `telegram:<chat_id>` (chat-level)
- `telegram:<chat_id>:thread:<thread_id>` (thread-level)

## 2) Send a fake-but-legit Telegram webhook

Set these first:

```bash
PLUGIN_INSTANCE_ID="<telegram-plugin-instance-id>"
CHAT_ID="<target-chat-id>"
THREAD_ID="<target-thread-id>"   # optional if plugin instance routes by thread
```

Send:

```bash
TS=$(date +%s)
UPDATE_ID=$((TS + 700000000))
MESSAGE_ID=$((TS % 1000000 + 9000000))
MARKER="E2E-${TS}"

cat > /tmp/nitejar-telegram-webhook-test.json <<EOF
{
  "update_id": ${UPDATE_ID},
  "message": {
    "message_id": ${MESSAGE_ID},
    "message_thread_id": ${THREAD_ID},
    "date": ${TS},
    "text": "Codex webhook smoke test ${MARKER}: please confirm and include ${MARKER} in your reply.",
    "chat": {
      "id": ${CHAT_ID},
      "type": "private"
    },
    "from": {
      "id": ${CHAT_ID},
      "is_bot": false,
      "first_name": "Local",
      "last_name": "Tester",
      "username": "localtester"
    }
  }
}
EOF

curl -sS -X POST \
  "http://localhost:3000/api/webhooks/plugins/telegram/${PLUGIN_INSTANCE_ID}" \
  -H 'content-type: application/json' \
  --data @/tmp/nitejar-telegram-webhook-test.json
```

Expected: `201` with `{"created":true,"workItemId":"..."}`.

Save `workItemId`.

Shortcut helper:

```bash
node scripts/e2e/send-telegram-webhook.mjs \
  --plugin-instance-id "<telegram-plugin-instance-id>" \
  --chat-id "<target-chat-id>" \
  --thread-id "<target-thread-id>" \
  --text "Codex webhook smoke test E2E-<ts>"
```

## 3) Monitor receipts until complete

```bash
WORK_ITEM_ID="<from-webhook-response>"
DB=packages/database/data/nitejar.db

# Work item state
sqlite3 -header -column "$DB" \
  "SELECT id, status, session_key, source_ref, created_at, updated_at
   FROM work_items
   WHERE id='${WORK_ITEM_ID}';"

# Jobs per agent
sqlite3 -header -column "$DB" \
  "SELECT j.id AS job_id, a.name AS agent, j.status, j.started_at, j.completed_at
   FROM jobs j
   JOIN agents a ON a.id=j.agent_id
   WHERE j.work_item_id='${WORK_ITEM_ID}'
   ORDER BY j.created_at;"

# Assistant replies (ground truth for response text)
sqlite3 -header -column "$DB" \
  "SELECT a.name AS agent, json_extract(m.content, '$.text') AS assistant_text, m.created_at
   FROM messages m
   JOIN jobs j ON j.id=m.job_id
   JOIN agents a ON a.id=j.agent_id
   WHERE j.work_item_id='${WORK_ITEM_ID}' AND m.role='assistant'
   ORDER BY m.created_at;"

# Queue/dispatch receipts
sqlite3 -header -column "$DB" \
  "SELECT id, queue_key, status, dispatch_id, created_at
   FROM queue_messages
   WHERE work_item_id='${WORK_ITEM_ID}'
   ORDER BY created_at;"

sqlite3 -header -column "$DB" \
  "SELECT id, queue_key, status, job_id, started_at, finished_at
   FROM run_dispatches
   WHERE work_item_id='${WORK_ITEM_ID}'
   ORDER BY created_at;"
```

## 4) Pass/fail rubric

Pass when all are true:

- Webhook returns `201` and `workItemId`.
- `work_items.status` reaches `DONE`.
- Each assigned agent has a terminal triage result (`shouldRespond=true` or `shouldRespond=false`) in receipts.
- For `shouldRespond=true`: job reaches `COMPLETED` and has at least one `messages.role='assistant'` row.
- For `shouldRespond=false`: no assistant message is expected for that agent on that work item.
- Assistant replies from responding agents include your marker (or expected assertion text).

If the bot token is valid, you should also see those replies in Telegram chat.

## Notes

- If Telegram `webhookSecret` is configured, include header:
  `x-telegram-bot-api-secret-token: <secret>`.
- Use unique `update_id` values to avoid idempotency collisions.
- Use unique `MARKER` text each run so receipts are easy to audit.
- Triage cost/latency is model-dependent. If triage is expensive/slow, tune model choice and
  triage settings (`triage max tokens`, `triage reasoning effort`) before treating it as an engine bug.
