# M1 — Foundational Platform: Testing Phase

**Status:** Implementation complete. All 8 phases done. Requires end-to-end testing before M1 is complete.

## Context

The foundational platform has been implemented:

- Kysely ORM schema with SQLite/Postgres support
- Integrations framework with registry/router (Telegram, GitHub)
- Sprites SDK wrapper for agent execution
- Agent inference loop with Anthropic API
- Admin dashboard UI (Next.js)
- Dockerfile and Fly.io deployment config
- WebSocket session management for persistent shell state

## Remaining Tasks

### 1. Test End-to-End Telegram Flow

Send a Telegram message and verify the complete pipeline:

- Webhook received at `/api/webhooks/telegram`
- Work item created in database
- Job created and assigned to agent
- Agent inference runs (Claude API)
- Tools executed on Sprite via `sprite exec`
- Response posted back to Telegram chat
- Verify message appears in Telegram

**Test steps:**

1. Create Telegram bot via @BotFather
2. Configure Telegram integration in admin UI
3. Create an agent
4. Send message to bot
5. Verify response received

### 2. Test End-to-End GitHub Flow

Create a GitHub issue/comment and verify the complete pipeline:

- Webhook received at `/api/webhooks/github`
- Work item created in database
- Job created and assigned to agent
- Agent inference runs (Claude API)
- Tools executed on Sprite via `sprite exec`
- Response posted as GitHub comment
- Verify comment appears on issue

**Test steps:**

1. Create GitHub App
2. Install on test repo
3. Configure GitHub integration in admin UI
4. Create an agent
5. Create issue or comment mentioning bot
6. Verify response comment posted

### 3. Test Fresh Docker Deployment

Deploy from scratch to verify deployment docs are accurate:

- Fresh Fly.io app (or other Docker host)
- Follow deployment guide exactly
- App starts successfully
- Create integration via admin UI
- Create agent via admin UI
- Run E2E test

**Test steps:**

1. Create new Fly.io app
2. Set required env vars
3. Deploy using `fly deploy`
4. Access admin UI
5. Complete setup
6. Test E2E flow

### 4. Verify Multiple Agents Work

Confirm multi-agent support functions correctly:

- Create 2+ agents in admin UI
- Each agent has its own Sprite
- Both agents appear in agent list
- Both can receive work items
- Work items routed correctly

### 5. Verify Sprite Tool Execution

Confirm agent tools work on Sprite:

- `bash` command executes and returns output
- `read_file` reads files from Sprite filesystem
- `write_file` writes files to Sprite filesystem
- `list_directory` lists directory contents
- Shell state persists within job (cd, env vars)
- Session cleanup works after job completes

### 6. Verify SSE Streaming

Confirm live streaming in admin UI:

- Open job detail page in admin UI
- Trigger a new job
- See live inference progress (not just final result)
- Messages appear as they're generated
- Reconnection works (refresh page, see history + live)

### 7. Verify Secrets Encryption

Confirm sensitive data is encrypted:

- Create integration with API token/secret
- Check database directly - config should show `enc:...` prefix
- Integration still works (decryption on read)
- Cannot read secrets in plain text from DB

### 8. Verify Idempotent Webhooks

Confirm duplicate prevention works:

- Send same webhook payload twice
- Only one work item created
- Idempotency key prevents duplicates
- Second request returns existing work item

## Exit Criteria

All must pass for M1 to be complete:

- [ ] Telegram message → work item → agent response (end-to-end)
- [ ] GitHub comment → work item → agent response (end-to-end)
- [ ] Multiple agents can exist and see work items
- [ ] Agent runs tools on Sprite via `sprite exec`
- [ ] Agent state persists across restarts (Sprite filesystem)
- [ ] Admin dashboard: manage integrations, agents, view work items
- [ ] SSE streaming shows live inference progress
- [ ] Secrets encrypted in database
- [ ] Fresh Docker deploy works following docs
- [ ] Idempotent webhook handling (no duplicate work items)
