# Test Plan 1: Routing Arbiter Pure Functions

## Goal

Add comprehensive unit tests for the pure/deterministic functions in `packages/agent/src/routing-arbiter.ts`. These are the parsing, normalization, and coercion functions that sit between raw model output and structured routing decisions. They are the most testable part of the system — no mocks needed for the pure functions, and the existing mock pattern covers the async `runRoutingArbiter` entrypoint.

## Target File

**New test file:** `packages/agent/src/routing-arbiter.test.ts`

## Source File

`packages/agent/src/routing-arbiter.ts`

**Note:** Several functions are not currently exported. You will need to export them (or use a `__test` escape hatch pattern like `effect-outbox-worker.ts` does) to test them directly. The functions to expose:

- `stripMarkdownFence`
- `parseLooseJson`
- `normalizeRouteLabel`
- `coerceRouteFromParsed`
- `buildSystemPrompt`
- `parseRoutingResponse`
- `normalizeUsage`

Add a test-only export block at the bottom of `routing-arbiter.ts`:

```typescript
export const __routingArbiterTest = {
  stripMarkdownFence,
  parseLooseJson,
  normalizeRouteLabel,
  coerceRouteFromParsed,
  buildSystemPrompt,
  parseRoutingResponse,
  normalizeUsage,
}
```

## Test Framework

Vitest. Follow the existing patterns in `packages/agent/src/triage.test.ts` and `packages/agent/src/steer-arbiter.test.ts`.

## Tests to Write

### 1. `stripMarkdownFence`

```
- strips ```json prefix and ``` suffix
- strips ``` prefix without language tag
- case-insensitive (```JSON)
- no-op on plain text (no fences)
- handles whitespace around fences
```

### 2. `parseLooseJson`

```
- parses valid JSON object
- parses JSON wrapped in markdown fences
- extracts JSON from prose: "Here is my answer: { ... } hope that helps"
- returns null for completely invalid text
- returns null for empty string
- returns null for JSON array (not object)
- handles nested braces correctly: {"reason": "a { b } c"}
- handles multiple JSON objects (picks first brace pair that parses)
```

### 3. `normalizeRouteLabel`

```
- 'respond' -> 'respond'
- 'reply' -> 'respond'
- 'act' -> 'respond'
- 'handle' -> 'respond'
- 'pass' -> 'pass'
- 'defer' -> 'pass'
- 'do_not_respond' -> 'pass'
- 'do-not-respond' -> 'pass'
- 'interrupt_now' -> 'interrupt_now'
- 'inject_now' -> 'interrupt_now'
- 'interrupt' -> 'interrupt_now'
- 'steer' -> 'interrupt_now'
- 'do_not_interrupt' -> 'do_not_interrupt'
- 'queue' -> 'do_not_interrupt'
- 'ignore' -> 'ignore'
- 'drop' -> 'ignore'
- 'skip' -> 'ignore'
- returns null for unknown labels ('banana', '', 'RESPOND_NOW')
- trims whitespace ('  respond  ' -> 'respond')
- case-insensitive ('RESPOND' -> 'respond', 'Pass' -> 'pass')
```

### 4. `coerceRouteFromParsed`

```
- extracts route from parsed.route string
- extracts route from parsed.decision string (fallback key)
- parsed.route takes precedence over parsed.decision
- normalizes route through normalizeRouteLabel
- returns defaultRoute when route is not in allowedRoutes
- falls back to parsed.respond boolean: true -> 'respond', false -> 'pass'
- parsed.respond only used when parsed.route/decision is missing
- returns defaultRoute when parsed.respond route is not in allowedRoutes
- returns defaultRoute for empty parsed object
- returns defaultRoute when route is non-string (number, null, etc.)
```

### 5. `buildSystemPrompt`

Test the prompt construction with various input combinations:

```
- includes target name and role in header
- includes target handle when provided
- omits handle line when not provided
- includes all rules as bullet points
- includes allowed routes in schema line
- includes "exclusive"?: boolean only in triage mode, not steer mode
- includes <recent_conversation> section when recentHistory provided
- omits <recent_conversation> when recentHistory is null/undefined
- includes <team_and_dispatch_context> when teamContext provided
- omits team context section when not provided
- includes <target_active_work> when activeWorkSnapshot provided
- includes triage decision framing only in triage mode
- does NOT include triage framing in steer mode
- escapes XML in recentHistory (prevent prompt injection)
- escapes XML in teamContext
- escapes XML in activeWorkSnapshot
```

Use a minimal `RunRoutingArbiterInput` fixture. You'll need an `Agent` object — use the same shape as in `triage.test.ts`:

```typescript
const agent: Agent = {
  id: 'agent-1',
  name: 'TestBot',
  handle: 'testbot',
  status: 'active',
  config: '{}',
  sprite_id: null,
  created_at: 0,
  updated_at: 0,
}
```

### 6. `parseRoutingResponse`

```
- parses valid routing JSON with route, reason, resources, readonly
- parses respond: true/false boolean form
- returns null for unparseable content
- returns null for empty content
- truncates reason to reasonMaxChars
- uses defaultReason when reason is empty/whitespace
- sets reasonAutoDerived=true when model reason was empty
- sets reasonAutoDerived=false when model provided a reason
- filters non-string resources from array
- returns empty resources array when resources is not an array
- coerces route through normalizeRouteLabel (e.g., "reply" -> "respond")
- returns defaultRoute for routes not in allowedRoutes
- sets readonly=true only when explicitly true in parsed JSON
```

### 7. `normalizeUsage`

```
- extracts prompt_tokens and completion_tokens
- calculates totalTokens as sum
- captures OpenRouter cost field from usage
- returns 0 for costUsd when cost field is not a number
- handles undefined usage gracefully (zero tokens)
- preserves model string and durationMs
```

### 8. `runRoutingArbiter` (integration, mocked model)

Follow the mock pattern from `triage.test.ts` — mock `model-client` and `config`:

```
- returns ok outcome with parsed route for valid model response
- returns empty_response outcome for empty model content
- returns invalid_json outcome for unparseable model response
- returns error outcome when model call throws
- uses defaultRoute and defaultReason for all failure outcomes
- sets reasonAutoDerived=true for all failure outcomes
- captures usage from model response
- passes reasoning effort config when triageSettings.reasoningEffort is set
- respects maxTokensCap (clamps maxTokens, floor of 150)
- uses triageSettings.maxTokens when configured
- falls back to input.maxTokensDefault when no triageSettings
```

## Approach Notes

- Do NOT call real models. Mock `getClient` and `withProviderRetry` exactly as `triage.test.ts` does.
- For pure function tests, no mocking is needed — just import and call directly.
- Each `describe` block should correspond to one function.
- Use `it.each` for the `normalizeRouteLabel` synonym table to keep it concise.
- Keep fixtures minimal. Reuse the `Agent` shape from existing tests.

## Verification

Run: `pnpm --filter @nitejar/agent test -- routing-arbiter`

All tests should pass. No type errors when running `pnpm run typecheck`.
