# Test Plan 6: Dispatch Worker Control Flow

## Goal

Add tests for the control flow logic in the dispatch worker: `apps/web/server/services/run-dispatch-worker.ts`. This is the highest-risk untested area — it manages lease-based claiming, heartbeats, pause/resume/cancel, and team context assembly. A bug here means double-processing or dropped work.

## Target File

**New test file:** `apps/web/server/services/run-dispatch-worker.test.ts`

## Source File

`apps/web/server/services/run-dispatch-worker.ts`

**Exports needed:** The file likely exposes `ensureRunDispatchWorker` and possibly `executeDispatch` or internal helpers. If `executeDispatch` and helper functions are not exported, add a test-only export block:

```typescript
export const __dispatchWorkerTest = {
  executeDispatch,
  claimAndDispatch,
  // any other internal helpers used in the flow
}
```

Read the actual file to determine what's exported and what needs a test escape hatch.

## Prerequisites

Before writing these tests, read the full `run-dispatch-worker.ts` file to understand:

1. The exact signature of `executeDispatch` and what it takes as input
2. What database functions it calls (claim, heartbeat, lease, etc.)
3. How team context is built (what repos/functions are called)
4. How it calls `runAgent` from `@nitejar/agent`
5. How it creates effect outbox entries after a run

## Mock Setup

This file has many dependencies. Mock all of them:

```typescript
// Database operations
vi.mock('@nitejar/database', () => ({
  claimNextRunDispatch: vi.fn(),
  releaseRunDispatchLease: vi.fn(),
  updateRunDispatch: vi.fn(),
  findWorkItemById: vi.fn(),
  findAgentById: vi.fn(),
  createEffectOutbox: vi.fn(),
  updateWorkItem: vi.fn(),
  getRuntimeControl: vi.fn(),
  getRunControl: vi.fn(),
  getRunControlDirective: vi.fn(),
  findLatestExclusiveClaimForWorkItem: vi.fn(),
  // ... other DB functions used
}))

// Agent runner
vi.mock('@nitejar/agent', () => ({
  runAgent: vi.fn(),
  parseAgentConfig: vi.fn(() => ({})),
}))

// Plugin handlers
vi.mock('@nitejar/plugin-handlers', () => ({
  getPluginInstanceWithConfig: vi.fn(),
  pluginHandlerRegistry: { get: vi.fn() },
}))
```

## Tests to Write

### 1. Claiming dispatches (new describe block)

```
- claims available dispatch from queue
- does nothing when no dispatch is available
- does nothing when processing_enabled is 0
- passes correct worker ID and lease seconds to claim function
```

### 2. Lease and heartbeat management (new describe block)

```
- attaches heartbeat interval after claiming dispatch
- clears heartbeat after dispatch completes
- clears heartbeat after dispatch fails
- releases lease on unrecoverable error
```

### 3. Pre-run validation (new describe block)

```
- fails dispatch when work item not found
- fails dispatch when agent not found
- loads agent config before running
```

### 4. Team context assembly (new describe block)

```
- finds exclusive claim for work item from other dispatches
- includes exclusive responder line in dispatch info when claim exists
- includes recent teammate activity in dispatch info
- excludes own dispatch from exclusive claim search
- passes team context to runAgent
```

### 5. Run execution (new describe block)

```
- calls runAgent with correct parameters (agent, workItem, context)
- passes triage context with recent history
- passes team context with teammate list
- passes active work snapshot
```

### 6. Post-run processing (new describe block)

```
- creates effect outbox entry when agent produces a response
- does not create effect entry when agent response is empty
- updates work item status after successful run
- updates dispatch status to completed after successful run
- marks dispatch as failed when runAgent throws
- records exclusive claim annotation when triage returns exclusive=true
```

### 7. Triage pass handling (new describe block)

```
- completes dispatch early when triage says shouldRespond=false
- records pass activity in activity log
- does not call runAgent when triage says pass
- does not create effect outbox when triage says pass
```

### 8. Control flow — pause/resume/cancel (new describe block)

```
- pauses dispatch when control directive is 'pause'
- resumes dispatch when control directive changes back to 'continue'
- cancels dispatch when control directive is 'cancel'
- passes steering messages to steer arbiter when directive has pending messages
```

## Approach Notes

- This is the most complex test file. Start by reading the full source to understand the exact function signatures and call patterns.
- Mock everything at the module boundary — database, agent runner, plugin handlers.
- Use `vi.fn()` for all external calls and assert they're called with expected arguments.
- For heartbeat tests, use `vi.useFakeTimers()` to control interval behavior.
- The team context assembly logic is the most intricate part — it queries multiple tables and assembles text. Test the final text passed to `runAgent`.
- For the triage pass path, verify the dispatch terminates early without calling `runAgent`.
- For post-run processing, verify the effect outbox entry has the correct payload structure.

## Fixtures

```typescript
const mockDispatch = {
  id: 'dispatch-1',
  run_key: 'run-1',
  queue_key: 'telegram:123:agent-1',
  work_item_id: 'wi-1',
  agent_id: 'agent-1',
  plugin_instance_id: 'int-1',
  session_key: 'telegram:123',
  status: 'running',
  input_text: 'Hello bot',
  coalesced_text: null,
  response_context: null,
  job_id: null,
  attempt_count: 0,
  claimed_by: 'worker-1',
  lease_expires_at: Date.now() / 1000 + 120,
  claimed_epoch: 1,
  control_state: null,
  control_reason: null,
  replay_of_dispatch_id: null,
}

const mockAgent = {
  id: 'agent-1',
  name: 'TestBot',
  handle: 'testbot',
  status: 'active',
  config: '{}',
  sprite_id: null,
  created_at: 0,
  updated_at: 0,
}

const mockWorkItem = {
  id: 'wi-1',
  plugin_instance_id: 'int-1',
  session_key: 'telegram:123',
  source: 'telegram',
  source_ref: 'msg:456',
  title: 'Hello bot',
  payload: '{}',
  status: 'NEW',
  created_at: 0,
  updated_at: 0,
}
```

## Verification

Run: `pnpm --filter web test -- run-dispatch-worker`

All tests should pass. No type errors.

## Note on Scope

This is the largest and most complex plan. If the file is too large to tackle at once, start with sections 1-3 (claiming, leases, validation) and 6-7 (post-run, triage pass) as they are the most critical paths. Sections 4-5 (team context, run execution) and 8 (control flow) can be a follow-up.
