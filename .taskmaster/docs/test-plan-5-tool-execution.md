# Test Plan 5: Tool Execution Pipeline

## Goal

Add tests for the tool orchestration layer: `packages/agent/src/tools.ts` (the `executeTool` function) and `packages/agent/src/message-utils.ts` (result formatting and message preparation). These are the glue between model tool_call outputs and the actual handler execution + result injection back into the conversation.

## Target Files

**Extend existing file:** `packages/agent/src/tools-orchestrator.test.ts` (currently has 3 tests)
**Extend existing file:** `packages/agent/src/message-utils.test.ts`

## Source Files

- `packages/agent/src/tools.ts` — `executeTool()` function
- `packages/agent/src/message-utils.ts` — `buildToolResultContent`, `truncateWithNotice`, `prepareMessagesForModel`, `extractContentText`, `stripImageInputs`
- `packages/agent/src/tools/types.ts` — `ToolContext`, `ToolResult`, `ToolHandler` types

## Part A: executeTool Tests

### File: `packages/agent/src/tools-orchestrator.test.ts`

The existing tests cover: unknown tool error, delegation to additional handlers, and error conversion. Add:

### 1. Handler lookup and dispatch (extend existing describe)

```
- calls the correct handler from toolHandlers registry
- passes input and context to the handler
- returns the handler's ToolResult directly
- prefers base registry over additionalHandlers when both have the tool
- falls back to additionalHandlers when base registry doesn't have the tool
```

### 2. Error handling (extend existing describe)

```
- catches Error thrown by handler, returns { success: false, error: message }
- catches non-Error thrown by handler, returns { success: false, error: String(thrown) }
- catches async rejection from handler
- does not catch errors from handler lookup (only from execution)
```

### 3. ToolResult metadata passthrough

```
- preserves _meta.cwd from handler result
- preserves _meta.sessionError from handler result
- preserves _meta.sessionInvalidated from handler result
- preserves _meta.sandboxSwitch from handler result
- preserves _meta.externalApiCost from handler result
- preserves _meta.editOperation from handler result
- preserves _meta.hashMismatch from handler result
```

### Mock Setup

Mock specific tool handlers inline:

```typescript
import { executeTool } from './tools'
import { toolHandlers } from './tools/handlers'

// Mock the handlers module
vi.mock('./tools/handlers', () => ({
  toolHandlers: {} as Record<string, unknown>,
}))

// In tests, set up handlers dynamically:
const mockHandler = vi.fn()
;(toolHandlers as Record<string, unknown>)['test_tool'] = mockHandler

// Or for additional handlers:
const additionalHandlers = { custom_tool: vi.fn() }
```

Minimal ToolContext:
```typescript
const minimalContext: ToolContext = {
  spriteName: 'test-sprite',
}
```

## Part B: Message Utils Tests

### File: `packages/agent/src/message-utils.test.ts`

Check what's already tested in this file, then add the following if missing.

### 1. `buildToolResultContent`

```
- success with output -> returns output
- success without output -> returns "Success"
- failure with output and error -> returns "output\n\nError: error"
- failure with error only -> returns "Error: error"
- failure with neither output nor error -> returns "Error: undefined"
```

### 2. `truncateWithNotice`

```
- returns text unchanged when under maxChars limit
- returns text unchanged when exactly at maxChars
- truncates and inserts notice when over limit
- notice includes character count of omitted content
- keeps 75% head and 25% tail of the kept content
- works with very short maxChars (edge case)
- handles empty string input
- handles single-character input with maxChars=1
```

### 3. `extractContentText`

```
- extracts text from string content
- extracts text from array of ContentPart objects
- concatenates multiple text parts
- returns empty string for null/undefined content
- returns empty string for non-string, non-array content
- ignores image_url parts (returns only text)
- handles mixed array of strings and objects
```

### 4. `getMessageContentLength`

```
- returns string length for string content
- returns combined length for array content
- returns 0 for empty content
```

### 5. `stripImageInputs`

```
- converts user messages with array content to string content
- leaves non-user messages unchanged
- leaves user messages with string content unchanged
- handles multiple messages (mix of user and assistant)
```

### 6. `prepareMessagesForModel`

```
- returns messages unchanged when under MAX_MODEL_INPUT_CHARS
- compacts tool messages first when over limit
- compacts non-tool messages (except first and last) when tool compaction isn't enough
- does not compact first message (system prompt)
- does not compact last message
- preserves messages shorter than MIN_MESSAGE_PRESERVE_CHARS
- reports correct compactedToolMessages count
- reports correct compactedNonToolMessages count
- reports correct initialChars and finalChars
```

For `prepareMessagesForModel` tests, you may need to temporarily override `MAX_MODEL_INPUT_CHARS` or create messages that exceed the default 6.5MB limit. Consider using `vi.stubEnv('AGENT_MODEL_INPUT_MAX_CHARS', '500')` before importing, or use dynamic import.

## Part C: Tool Result Truncation Integration

### New file: `packages/agent/src/tool-result-integration.test.ts`

This tests the pattern used in the runner where tool results are truncated before being added to conversation. This is a unit test of the composition, not the runner itself.

```
- truncateWithNotice applied to buildToolResultContent output
- long tool output is truncated with notice before model sees it
- truncation preserves head (75%) and tail (25%) with notice in middle
- short tool output passes through unchanged
- error output is also subject to truncation when very long
```

## Approach Notes

- `executeTool` is a thin orchestrator — tests mainly verify correct dispatch and error wrapping.
- `message-utils` functions are all pure — no mocking needed, just call and assert.
- For `prepareMessagesForModel`, constructing messages over 6.5MB is expensive. Consider setting a lower env var for the test or mocking the constant.
- Import types from `packages/agent/src/tools/types.ts` for fixture construction.
- The existing `tools-orchestrator.test.ts` already mocks the handlers module. Extend its pattern.

## Verification

Run:
```bash
pnpm --filter @nitejar/agent test -- tools-orchestrator
pnpm --filter @nitejar/agent test -- message-utils
pnpm --filter @nitejar/agent test -- tool-result-integration
```

All tests should pass. No type errors.
