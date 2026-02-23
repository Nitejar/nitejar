# Test Plan 2: Triage Orchestration Logic

## Goal

Expand tests for `packages/agent/src/triage.ts` — specifically the helper functions that transform context before the arbiter call and interpret the result afterward. The existing `triage.test.ts` has 15 tests covering the happy path and fail-closed behavior. This plan targets the internal functions that are currently untested.

## Target File

**Extend existing file:** `packages/agent/src/triage.test.ts`

## Source File

`packages/agent/src/triage.ts`

**Exports needed:** Several internal functions are not exported. Add a test-only export block at the bottom of `triage.ts`:

```typescript
export const __triageTest = {
  normalizeForDuplicateComparison,
  dedupeRecentHistory,
  extractExclusiveDispatchLine,
  mergeArbiterTranscriptContext,
  extractExclusiveClaim,
}
```

## Existing Mock Pattern

The file already mocks `model-client`, `config`, and `prompt-builder`. Follow the exact same pattern for new tests. See lines 8-41 of the existing test file.

## Tests to Add

### 1. `normalizeForDuplicateComparison` (new describe block)

This function strips prefixes, collapses whitespace, and lowercases text for dedup comparison.

```
- strips "User: " prefix
- strips "You: " prefix (case-insensitive)
- strips [@handle]: prefix (e.g., "[@pixel]: hello" -> "hello")
- strips [bracketed label] prefix (e.g., "[🎨 Pixel] hello" -> "hello")
- strips [session: ...] lines entirely
- collapses multiple whitespace to single space
- trims leading/trailing whitespace
- lowercases the result
- handles multiline input (joins non-empty lines with space)
- returns empty string for empty/whitespace-only input
- returns empty string for session-only line: "[session: telegram:123]"
```

### 2. `dedupeRecentHistory` (new describe block)

This function removes trailing lines from recent history that duplicate the incoming user message.

```
- removes last history line when it matches the user content (after normalization)
- removes multiple trailing duplicates (e.g., two identical trailing lines)
- stops removing when a non-matching line is hit
- does NOT remove non-trailing matches (only strips from the end)
- returns context unchanged when no trailing match
- returns context with recentHistory=null when all lines are duplicates
- returns undefined when input context is undefined
- returns context unchanged when recentHistory is null
- handles prefix differences: history says "[@pixel]: 4", user says "[🎨 Pixel] 4" — these match
- handles case differences in matching
```

### 3. `extractExclusiveDispatchLine` (new describe block)

```
- extracts line starting with "Exclusive responder volunteer for this work item:"
- returns null when no such line exists
- returns null for undefined/empty teamContext
- handles multiline team context (finds the right line)
- case-insensitive match on the prefix
- trims whitespace from extracted line
```

### 4. `mergeArbiterTranscriptContext` (new describe block)

This function appends the exclusive dispatch signal as a synthetic system line into the recent conversation.

```
- appends "System: [dispatch] Exclusive responder..." line to existing history
- returns just the synthetic line when recentHistory is null
- returns recentHistory unchanged when no exclusive line in teamContext
- does NOT duplicate the synthetic line if already present
- returns null when both recentHistory is null and no exclusive line
- handles whitespace-only recentHistory (treated as null)
```

### 5. `extractExclusiveClaim` (new describe block)

```
- returns true for { exclusive: true }
- returns true for { exclusive_claim: true }
- returns true for { exclusiveClaim: true }
- returns true for { volunteer_exclusive: true }
- returns false for { exclusive: false }
- returns false for {} (no exclusive field)
- returns false for null input
- returns false for { exclusive: "true" } (string, not boolean)
```

### 6. `triageWorkItem` — additional edge cases (extend existing describe block)

These extend the existing tests to cover more orchestration behavior:

```
- uses coalescedText when provided instead of buildUserMessage
- falls back to buildUserMessage when coalescedText is undefined
- prepends issue preamble for GitHub work items (when buildIssuePreamble returns content)
- appends session_key context hint to user prompt
- deduplicates trailing history before sending to arbiter
- exclusive claim is false when shouldRespond is false (even if parsed.exclusive=true)
- handles route="respond" with alternative key names: "exclusive_claim", "exclusiveClaim", "volunteer_exclusive"
- triage context agentName/agentHandle overrides agent.name/agent.handle when provided
- active work snapshot is passed through to arbiter when present in triageContext
```

## Approach Notes

- All model calls are already mocked via `withProviderRetry`. For the new `triageWorkItem` tests, use the same mock setup from `beforeEach`.
- For the pure function tests (`normalizeForDuplicateComparison`, etc.), no mocking needed — import from `__triageTest` and call directly.
- For tests that need to inspect the system prompt sent to the model, follow the pattern from the existing test at line 261 — mock `getClient` to capture the `create` call and inspect `messages[0].content`.

## Verification

Run: `pnpm --filter @nitejar/agent test -- triage`

All tests should pass. No type errors.
