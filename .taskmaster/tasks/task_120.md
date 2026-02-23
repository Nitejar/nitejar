# Task ID: 120

**Title:** Implement PR State Tracking (Pending Approval)

**Status:** cancelled

**Dependencies:** 115 ✓

**Priority:** medium

**Description:** Create a persistent state tracking mechanism to remember which PRs are waiting for human approval via Telegram to avoid duplicate prompts, utilizing the existing Kysely database infrastructure.

**Details:**

1. Implement persistent storage using Kysely migrations in `packages/database`.
2. Create a new table `pr_approval_states`.
3. Required Schema Fields:
   - `pr_id` (Integer: unique identifier for the PR)
   - `repo_name` (String: to distinguish PRs across repos)
   - `prompt_message_id` (Integer: Telegram message ID for tracking replies)
   - `chat_id` (Integer/String: Telegram chat ID)
   - `status` (Enum/String: 'pending_approval', 'approved', 'rejected', 'merged')
   - `created_at` (Timestamp)
   - `updated_at` (Timestamp)
4. Implementation:
   - Add migration file in `packages/database/migrations`.
   - Update Kysely types in `packages/database/src/types.ts`.
   - Create a repository/helper in `packages/database` to manage these records.
   - In `apps/web` (or where the telegram logic resides), check DB for 'pending_approval' before sending prompts.

**Test Strategy:**

Integration test with DB: Run migration, create a record via Kysely, verify persistence. Verify duplication check logic. Unit test the repository functions in `packages/database`.

## Subtasks

### 120.1. Create Kysely Migration and Types

**Status:** pending  
**Dependencies:** None  

Add a new migration for `pr_approval_states` table and update TypeScript interfaces.

**Details:**

1. Create migration file in `packages/database/migrations` creating table `pr_approval_states`.
2. Columns: `id` (serial pk), `pr_id` (int), `repo_name` (varchar), `prompt_message_id` (bigint), `chat_id` (bigint), `status` (varchar), `created_at`, `updated_at`.
3. Add unique index on `(pr_id, repo_name)` where status is pending.
4. Update `Database` interface in `packages/database/src/types.ts`.

### 120.2. Implement PR State Repository

**Status:** pending  
**Dependencies:** 120.1  

Create data access functions in `packages/database`.

**Details:**

Create `packages/database/src/repositories/pr-approval.ts` (or similar) with functions:
- `createApprovalRequest(db, data)`
- `findPendingRequest(db, prId, repoName)`
- `updateRequestStatus(db, id, status)`

### 120.3. Integrate State Check into Telegram Logic

**Status:** pending  
**Dependencies:** 120.2  

Modify the Telegram prompt logic in `apps/web` to use the new repository functions.

**Details:**

In the logic from Task 115 (likely in `apps/web/src/app/api/webhooks/telegram` or a service):
1. Import repository functions from `@nitejar/database`.
2. Before sending prompt: `const existing = await findPendingRequest(...)`.
3. If exists, skip.
4. After sending: `await createApprovalRequest(...)` with the `message_id`.
