# Test Plan 4: Effect Outbox Worker — Delivery Lifecycle

## Goal

Expand tests for `apps/web/server/services/effect-outbox-worker.ts`. The existing test file covers the agent relay path (2 tests). This plan adds coverage for the core `processNextEffect` delivery lifecycle: claiming, hook dispatch, outcome handling, retry logic, and error cases.

## Target File

**Extend existing file:** `apps/web/server/services/effect-outbox-worker.test.ts`

## Source File

`apps/web/server/services/effect-outbox-worker.ts`

The test-accessible entrypoint is already exported: `__effectOutboxTest.processNextEffect`

## Existing Mock Pattern

The file already mocks `@nitejar/database`, `@nitejar/plugin-handlers`, `@nitejar/agent`, and `./routines/publish`. It also needs to mock the hook dispatch. Add:

```typescript
const mockDispatchHook = vi.fn()

vi.mock('./plugins/hook-dispatch', () => ({
  dispatchHook: mockDispatchHook,
}))
```

Default the hook mock in `beforeEach`:
```typescript
mockDispatchHook.mockResolvedValue({ blocked: false, data: {} })
```

## Tests to Add

### 1. Processing control gate (new describe block)

```
- does nothing when processing_enabled is 0
- does nothing when processing_enabled is not 1
- proceeds when processing_enabled is 1
```

### 2. Claiming and basic delivery (new describe block)

```
- does nothing when no effect is available to claim (claimNextEffectOutbox returns null)
- calls postResponse handler with content, responseContext, and options from payload
- marks effect as sent with providerRef when handler returns success+sent
- passes expectedEpoch to markEffectOutboxSent for optimistic concurrency
```

### 3. Missing plugin/handler (new describe block)

```
- marks failed (non-retryable) when plugin instance not found
- marks failed (non-retryable) when plugin handler has no postResponse method
- marks failed (non-retryable) when payload content is missing/empty
```

### 4. Hook dispatch — response.pre_deliver (new describe block)

```
- calls dispatchHook('response.pre_deliver', ...) before sending
- blocks delivery and marks failed when hook returns { blocked: true }
- transforms content when hook returns updated content string
- uses original content when hook returns no content override
- proceeds normally when hook throws (non-fatal)
```

### 5. Hook dispatch — response.post_deliver (new describe block)

```
- calls dispatchHook('response.post_deliver', ...) after successful send
- proceeds normally when post_deliver hook throws (non-fatal)
```

### 6. Outcome handling (new describe block)

```
- marks sent for outcome 'sent' (explicit)
- marks sent when outcome is undefined but success is true
- marks unknown for outcome 'unknown'
- marks failed (retryable) when result.retryable is true
- marks failed (non-retryable) when result.retryable is false/undefined
- marks unknown on transport-level exception (catch block)
```

### 7. Retry delay calculation (new describe block)

Test the `retryDelaySeconds` function. You'll need to export it or test indirectly.

Add to the `__effectOutboxTest` export:

```typescript
export const __effectOutboxTest = {
  processNextEffect,
  retryDelaySeconds,
}
```

```
- attempt 0 -> 5 seconds (floor)
- attempt 1 -> 10 seconds
- attempt 2 -> 20 seconds
- attempt 5 -> 50 seconds
- attempt 30 -> 300 seconds (cap)
- attempt 100 -> 300 seconds (cap)
```

Also test that `markEffectOutboxFailed` is called with the correct `nextAttemptAt` value for retryable failures. The formula is: `Math.floor(Date.now() / 1000) + retryDelaySeconds(attempt_count + 1)`.

### 8. Relay skipping conditions (extend existing describe block)

```
- does not relay when content is empty/whitespace
- does not relay when actor is not kind 'agent'
- does not relay when actor is undefined
- does not relay when source work item has no plugin_instance_id
- does not relay when source work item has no session_key
- does not relay when relay depth >= MAX_AGENT_PUBLIC_RELAY_DEPTH (12)
- does not relay when a relay work item already exists (dedup check)
- does not relay when no agents are registered for the plugin instance
- does not relay when only the origin agent is registered (no target agents)
- increments relayDepth in the relay work item payload
```

## Fixtures

Reuse the existing fixtures from the test file. For new test cases, adjust the mock returns:

```typescript
// Minimal effect for non-relay tests
const baseEffect = {
  id: 'effect-1',
  plugin_instance_id: 'int-1',
  work_item_id: 'wi-1',
  job_id: 'job-1',
  payload: JSON.stringify({
    content: 'Hello from the agent!',
    responseContext: { chatId: 123 },
  }),
  attempt_count: 0,
  claimed_epoch: 1,
}
```

## Approach Notes

- The `processNextEffect` function is already exposed via `__effectOutboxTest`. Use it directly.
- For the retry delay test, either export `retryDelaySeconds` or test it indirectly by checking the `nextAttemptAt` value passed to `markEffectOutboxFailed`.
- Use `vi.useFakeTimers()` if you need deterministic time for retry delay calculations. Otherwise, use `vi.spyOn(Date, 'now')`.
- Keep the existing 2 relay tests intact. Add new describe blocks alongside them.

## Verification

Run: `pnpm --filter web test -- effect-outbox-worker`

All tests should pass. No type errors.
