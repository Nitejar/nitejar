# M3 — Workflows

**Goal:** Multi-step structured processes for complex tasks.

**Dependencies:** M2 complete (agent soul enables better workflow execution)

## Overview

Currently agents handle single-turn interactions. M3 adds workflows - multi-step processes that can span multiple tool calls, wait for external input, and handle failures gracefully. The flagship workflow is Issue → PR.

## Features

### 1. Workflow Primitives

**What it does:** Define a system for creating and executing multi-step flows.

**Workflow components:**

- **Steps:** Ordered list of actions to perform
- **State:** Data passed between steps (accumulated context)
- **Branching:** Conditional paths based on step results
- **Wait points:** Pause for external input (approval, user response)
- **Error handling:** What to do when a step fails

**Implementation options:**

- **Code-based:** Workflows defined as TypeScript functions
- **Config-based:** YAML/JSON workflow definitions
- **Hybrid:** Simple flows in config, complex in code

**Recommended approach:** Start with code-based (TypeScript), add config layer later.

**Data model:**

```sql
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  definition JSONB NOT NULL, -- steps, conditions, etc.
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT REFERENCES workflows(id),
  job_id TEXT REFERENCES jobs(id),
  status TEXT NOT NULL, -- pending, running, waiting, completed, failed
  current_step INTEGER DEFAULT 0,
  state JSONB DEFAULT '{}',
  error_text TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);
```

### 2. Issue-to-PR Workflow (Flagship)

**What it does:** Complete flow from issue to merged PR.

**Steps:**

1. **Parse issue:** Extract requirements, acceptance criteria
2. **Clone repository:** Clone to Sprite filesystem
3. **Create branch:** `fix/issue-{number}` or `feature/issue-{number}`
4. **Analyze codebase:** Understand structure, find relevant files
5. **Plan implementation:** Create implementation plan
6. **Implement changes:** Write/modify code files
7. **Run tests:** Execute test suite, lint
8. **Create PR:** Open PR with description linking issue
9. **Post summary:** Comment on issue with PR link

**Progress updates during workflow:**

- Step 1: "Analyzing issue requirements..."
- Step 3: "Created branch `fix/issue-123`"
- Step 6: "Implementing changes (3 files modified)..."
- Step 7: "Running tests... 42 passed, 0 failed"
- Step 8: "Created PR #456"

**Error handling:**

- Tests fail → Report failure, suggest fixes, option to retry
- Merge conflicts → Report conflict, option to rebase
- API errors → Retry with backoff

### 3. Progress Updates

**What it does:** Post status updates back to source integration during workflow.

**Implementation:**

- **GitHub:** Comment on issue showing progress
- **Telegram:** Send messages with status
- **Admin UI:** Real-time workflow progress view

**Update types:**

- Step started: "Starting step 3: Create branch..."
- Step completed: "Branch `fix/issue-123` created"
- Error occurred: "Test suite failed: 2 tests failing"
- Waiting: "Waiting for approval to proceed..."
- Completed: "Workflow complete! PR #456 created"

**Rate limiting:**

- Don't spam with every micro-update
- Batch updates if steps complete quickly
- Configurable update frequency

### 4. Verification Steps

**What it does:** Run tests/lint as workflow verification.

**Built-in verifications:**

- **Test runner:** Detect and run test command (`npm test`, `pytest`, etc.)
- **Linter:** Run lint command if configured
- **Type check:** Run type checker if applicable
- **Custom commands:** User-defined verification commands

**Verification results:**

- Include in PR description
- Block workflow if critical verification fails
- Configurable: fail-fast vs continue-on-error

**PR description format:**

```markdown
## Changes

- Modified `src/auth.ts` to fix login bug
- Added test case in `tests/auth.test.ts`

## Verification

✅ Tests: 42 passed, 0 failed
✅ Lint: No issues
✅ Types: No errors

Fixes #123
```

### 5. Rollback Handling

**What it does:** Handle failures gracefully with rollback options.

**Tracking changes:**

- Record file changes at each step
- Track branch creation
- Track commits made

**Rollback actions:**

- **Soft rollback:** Keep branch, allow manual fix
- **Hard rollback:** Delete branch, discard all changes
- **Partial rollback:** Undo last N steps

**Failure recovery options:**

- **Retry step:** Run failed step again
- **Skip step:** Continue without this step
- **Abort workflow:** Stop and rollback
- **Manual intervention:** Pause for human help

**Implementation:**

```sql
CREATE TABLE workflow_changes (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT REFERENCES workflow_runs(id),
  step_index INTEGER NOT NULL,
  change_type TEXT NOT NULL, -- file_create, file_modify, branch_create, commit
  change_data JSONB NOT NULL, -- path, before/after content, etc.
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Built-in Workflows

### Issue to PR

- Trigger: Issue created/assigned to agent
- Result: PR created and linked

### PR Review

- Trigger: PR created/updated
- Result: Review comments posted

### Bug Triage

- Trigger: Issue created with bug label
- Result: Priority assigned, reproduction attempted

### Release Notes

- Trigger: Manual or on tag
- Result: Release notes generated from commits

## Exit Criteria

- [ ] Workflow primitives implemented (steps, state, branching)
- [ ] Issue-to-PR workflow works end-to-end
- [ ] From an issue: agent creates a PR that passes tests
- [ ] Progress updates posted to source integration
- [ ] Verification steps (tests, lint) run automatically
- [ ] Verification results included in PR description
- [ ] Failed steps can be retried
- [ ] Workflows can be rolled back on failure
- [ ] Workflow status visible in admin UI
- [ ] Wait points work (pause for external input)
