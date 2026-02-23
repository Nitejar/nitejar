# Agent E2E Rerun Quickstart

Use this to replay the exact small-scope autonomy checks that were validated on 2026-02-18.

## 0) Fast deterministic IA relay guard (count-to-10)

```bash
pnpm --filter @nitejar/web test -- 'app/api/webhooks/plugins/[type]/[instanceId]/route.test.ts'
```

Expected:

- 10 alternating agent-origin turns are processed.
- Each agent gets 5 runs.
- Final relay output is `10 (stop)`.

## 0b) Telegram live inter-agent idea exchange (full E2E)

```bash
DB=packages/database/data/nitejar.db
TG_PLUGIN=e77e1608-d35b-4f25-8134-48e6d42c8c19
TG_CHAT=163664445
TG_THREAD=58687
RID=$(date +%s)

node scripts/e2e/send-telegram-webhook.mjs \
  --plugin-instance-id "$TG_PLUGIN" \
  --chat-id "$TG_CHAT" \
  --thread-id "$TG_THREAD" \
  --sender-id 42100001 \
  --sender-name IAFlowA \
  --sender-username iaflowa \
  --text "@nitejar-dev TG-IA-FLOW-$RID step 1/2: propose one idea then ask @pixel for one idea. include marker TG-IA-FLOW-$RID-A" \
  | tee /tmp/tg_ia_msg1.json

sleep 4

node scripts/e2e/send-telegram-webhook.mjs \
  --plugin-instance-id "$TG_PLUGIN" \
  --chat-id "$TG_CHAT" \
  --thread-id "$TG_THREAD" \
  --sender-id 42100002 \
  --sender-name IAFlowB \
  --sender-username iaflowb \
  --text "@pixel TG-IA-FLOW-$RID step 2/2: add your idea and include marker TG-IA-FLOW-$RID-B" \
  | tee /tmp/tg_ia_msg2.json

W1=$(jq -r '.body.workItemId' /tmp/tg_ia_msg1.json)
W2=$(jq -r '.body.workItemId' /tmp/tg_ia_msg2.json)
echo "W1=$W1"
echo "W2=$W2"
```

Expected:

- W1: Slopper responds with marker `...-A`; Pixel passes.
- W2: Pixel responds with marker `...-B`; Slopper passes.

Receipt checks:

```bash
sqlite3 -header -column "$DB" \
  "SELECT id,status,source_ref,created_at,updated_at FROM work_items WHERE id IN ('$W1','$W2') ORDER BY created_at;"

sqlite3 -header -column "$DB" \
  "SELECT j.id AS job_id,a.handle,j.work_item_id,j.status,j.started_at,j.completed_at
   FROM jobs j JOIN agents a ON a.id=j.agent_id
   WHERE j.work_item_id IN ('$W1','$W2') ORDER BY j.created_at;"

sqlite3 -header -column "$DB" \
  "SELECT j.work_item_id,a.handle,m.role,substr(json_extract(m.content,'$.text'),1,220) AS text,m.created_at
   FROM messages m JOIN jobs j ON j.id=m.job_id JOIN agents a ON a.id=j.agent_id
   WHERE j.work_item_id IN ('$W1','$W2') AND m.role='assistant'
   ORDER BY m.created_at;"

sqlite3 -header -column "$DB" \
  "SELECT id,work_item_id,queue_key,status,control_reason,job_id,last_error,started_at,finished_at
   FROM run_dispatches
   WHERE work_item_id IN ('$W1','$W2')
   ORDER BY created_at;"

sqlite3 -header -column "$DB" \
  "SELECT id,work_item_id,status,kind,last_error,sent_at
   FROM effect_outbox
   WHERE work_item_id IN ('$W1','$W2')
   ORDER BY created_at;"
```

## Prereqs

- Dev server running on `http://localhost:3000`
- Local DB at `packages/database/data/nitejar.db`
- Telegram plugin instance ID and target chat/thread
- GitHub plugin instance ID and a real existing issue number

Set once:

```bash
DB=packages/database/data/nitejar.db
TG_PLUGIN=e77e1608-d35b-4f25-8134-48e6d42c8c19
TG_CHAT=163664445
TG_THREAD=58687
GH_PLUGIN=6f06af20-23ae-4d30-bc86-a144cf540e6c
GH_ISSUE=9
RID=$(date +%s)
```

## 1) RW-03 (interrupt_now)

```bash
A=$(node scripts/e2e/send-telegram-webhook.mjs \
  --plugin-instance-id "$TG_PLUGIN" \
  --chat-id "$TG_CHAT" \
  --thread-id "$TG_THREAD" \
  --sender-id 42010001 \
  --sender-name RW03A \
  --sender-username rw03a \
  --text "@slopper RW03-$RID-A run sleep 25 then output TASK-A-RW03-$RID")

sleep 8

B=$(node scripts/e2e/send-telegram-webhook.mjs \
  --plugin-instance-id "$TG_PLUGIN" \
  --chat-id "$TG_CHAT" \
  --thread-id "$TG_THREAD" \
  --sender-id 42010002 \
  --sender-name RW03B \
  --sender-username rw03b \
  --text "@slopper RW03-$RID-B urgent: pause A and output TASK-B-RW03-$RID")

echo "$A"
echo "$B"
```

Expected: slopper dispatch gets `arbiter:interrupt_now` and no runtime crash.

## 2) do_not_interrupt

```bash
A=$(node scripts/e2e/send-telegram-webhook.mjs \
  --plugin-instance-id "$TG_PLUGIN" \
  --chat-id "$TG_CHAT" \
  --thread-id "$TG_THREAD" \
  --sender-id 42010101 \
  --sender-name DNIA \
  --sender-username dnia \
  --text "@slopper DNI-$RID-A run sleep 25 then output MARK-A-DNI-$RID")

sleep 5

B=$(node scripts/e2e/send-telegram-webhook.mjs \
  --plugin-instance-id "$TG_PLUGIN" \
  --chat-id "$TG_CHAT" \
  --thread-id "$TG_THREAD" \
  --sender-id 42010102 \
  --sender-name DNIB \
  --sender-username dnib \
  --text "@slopper DNI-$RID-B non-urgent follow-up: after task A output MARK-B-DNI-$RID")

echo "$A"
echo "$B"
```

Expected: slopper dispatch logs `arbiter:do_not_interrupt`; follow-up is queued then handled later.

## 3) ignore

```bash
A=$(node scripts/e2e/send-telegram-webhook.mjs \
  --plugin-instance-id "$TG_PLUGIN" \
  --chat-id "$TG_CHAT" \
  --thread-id "$TG_THREAD" \
  --sender-id 42010201 \
  --sender-name IGNA \
  --sender-username igna \
  --text "@slopper IGN-$RID-A run sleep 25 then output MARK-A-IGN-$RID")

sleep 5

B=$(node scripts/e2e/send-telegram-webhook.mjs \
  --plugin-instance-id "$TG_PLUGIN" \
  --chat-id "$TG_CHAT" \
  --thread-id "$TG_THREAD" \
  --sender-id 42010202 \
  --sender-name IGNB \
  --sender-username ignb \
  --text "@slopper IGN-$RID-B no action needed, ignore this message completely, no follow-up needed.")

echo "$A"
echo "$B"
```

Expected: slopper dispatch logs `arbiter:ignore`; slopper lane queue message status becomes `dropped` with `drop_reason` including `arbiter:ignore`.

## 4) GitHub mention routing + delivery

```bash
node scripts/e2e/send-github-webhook.mjs \
  --plugin-instance-id "$GH_PLUGIN" \
  --issue-number "$GH_ISSUE" \
  --comment-id $((1000000000 + RID)) \
  --text "@pixel GH-A-$RID reply GH-A-$RID"

sleep 2

node scripts/e2e/send-github-webhook.mjs \
  --plugin-instance-id "$GH_PLUGIN" \
  --issue-number "$GH_ISSUE" \
  --comment-id $((1000000100 + RID)) \
  --text "@nitejar-dev GH-B-$RID reply GH-B-$RID"
```

Expected: addressed agent completes, non-addressed passes, and `effect_outbox.status='sent'`.

## Receipt checks

For each `workItemId` returned above:

```bash
WID="<work-item-id>"

sqlite3 -header -column "$DB" \
  "SELECT id,status,source,source_ref,created_at,updated_at FROM work_items WHERE id='$WID';"

sqlite3 -header -column "$DB" \
  "SELECT id,agent_id,status,error_text FROM jobs WHERE work_item_id='$WID' ORDER BY created_at;"

sqlite3 -header -column "$DB" \
  "SELECT id,status,control_reason,last_error FROM run_dispatches WHERE work_item_id='$WID' ORDER BY created_at;"

sqlite3 -header -column "$DB" \
  "SELECT id,queue_key,status,dispatch_id,drop_reason,text FROM queue_messages WHERE work_item_id='$WID' ORDER BY created_at;"

sqlite3 -header -column "$DB" \
  "SELECT id,status,kind,last_error FROM effect_outbox WHERE work_item_id='$WID' ORDER BY created_at;"
```
