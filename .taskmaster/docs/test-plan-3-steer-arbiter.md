# Test Plan 3: Steer Arbiter Deterministic Logic

## Goal

Expand tests for `packages/agent/src/steer-arbiter.ts`. The existing `steer-arbiter.test.ts` has 6 tests covering the model-backed path and one deterministic ignore case. This plan adds thorough coverage for the deterministic no-op detection (regex patterns) and the prompt construction, which are pure functions that don't need model calls.

## Target File

**Extend existing file:** `packages/agent/src/steer-arbiter.test.ts`

## Source File

`packages/agent/src/steer-arbiter.ts`

**Exports needed:** Add a test-only export block:

```typescript
export const __steerArbiterTest = {
  isExplicitNoOpMessage,
  getDeterministicIgnoreDecision,
  buildArbiterUserPrompt,
  EXPLICIT_NO_OP_PATTERNS,
  ACTIONABLE_HINT_PATTERNS,
}
```

## Tests to Add

### 1. `isExplicitNoOpMessage` — no-op detection (new describe block)

This function returns `true` when text matches a no-op pattern AND does NOT match an actionable hint.

**Should return true (no-op, no model call needed):**

```
- "no action needed"
- "no follow-up needed"
- "no followup needed" (no hyphen variant)
- "ignore this message"
- "ignore this completely"
- "ignore this for now"
- "disregard this"
- "never mind"
- "nevermind"
- "nvm"
- "fyi"
- "fyi only"
- "just fyi"
- "for your info"
- "thanks"
- "thanks "  (with trailing space — regex requires \s or end)
- "thank you"
- "thank you "
- "all good"
- "resolved"
- "" (empty string)
- "   " (whitespace only)
```

**Should return false (contains actionable hint, needs model call):**

```
- "thanks, but please run the tests first"  (thanks + please)
- "fyi, please review this PR" (fyi + please + review)
- "ignore this for now, but create a ticket" (ignore + create)
- "resolved, but please update the docs" (resolved + please + update)
- "nvm actually please fix the build" (nvm + please + fix)
- "all good, now run the deploy" (all good + run)
```

**Should return false (no no-op signal at all):**

```
- "what's the status?"
- "can you review my PR?"
- "hello"
- "@pixel do this"
```

### 2. `getDeterministicIgnoreDecision` — batch no-op detection (new describe block)

```
- returns ignore when ALL pending messages are no-ops
- returns ignore for single no-op message
- returns null when ANY message is not a no-op (must call model)
- returns null when pending messages is empty array
- returns null for mix of no-op and actionable messages
- returned reason contains 'no-op' or 'non-actionable'
- returned usage is null (no model call made)
```

### 3. `buildArbiterUserPrompt` — prompt construction (new describe block)

```
- includes agent handle and name
- includes queue key and session key
- includes objective text (truncated to 2500 chars)
- includes numbered pending messages with sender names
- includes numbered active work items with status, source, session, title
- shows "(none)" when no active work
- sanitizes sender names and message text (via sanitize/sanitizeLabel)
- handles multiple pending messages (numbered 1., 2., etc.)
- handles multiple active work items
- truncates very long objective text at 2500 chars
```

### 4. `decideSteeringAction` — additional integration tests (extend existing describe)

```
- skips model call entirely for "thanks" message (deterministic ignore)
- skips model call for "resolved" message
- skips model call for multiple no-op messages: ["thanks", "all good"]
- calls model for "thanks, but please fix the tests" (has actionable signal)
- calls model for mixed messages: ["thanks", "urgent: fix build now"]
- model returning "steer" synonym -> normalized to "interrupt_now"
- model returning "queue" synonym -> normalized to "do_not_interrupt"
- model returning "drop" synonym -> normalized to "ignore"
- model returning "skip" synonym -> normalized to "ignore"
- empty model response -> defaults to "do_not_interrupt"
```

## Approach Notes

- The existing test file already mocks `model-client` via `vi.hoisted`. Reuse that setup.
- For pure function tests, import from `__steerArbiterTest` — no mocking needed.
- Use `it.each` for the large tables of no-op pattern matching to keep it concise.
- The `Agent` fixture is already defined as `testAgent()` in the existing file — reuse it.

## Verification

Run: `pnpm --filter @nitejar/agent test -- steer-arbiter`

All tests should pass. No type errors.
