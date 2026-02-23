# Task ID: 94

**Title:** Backend: Agent Runtime Gateway Integration

**Status:** done

**Dependencies:** 87 ✓, 92 ✓

**Priority:** high

**Description:** Update the agent execution runtime to use the global gateway configuration.

**Details:**

1. Modify the agent runtime code to fetch the global gateway settings (API Key, Base URL).
2. Construct the LLM client (e.g., OpenAI SDK compatible) using the global settings and the agent's selected `modelId`.
3. Pass agent-configured parameters (temp, max_tokens, advanced params) to the inference call.
4. Remove any hardcoded model logic or environment variable fallbacks if they are being replaced.

**Test Strategy:**

Integration test: Run a full agent interaction flow. Verify the request is sent to OpenRouter with the correct model and parameters.
