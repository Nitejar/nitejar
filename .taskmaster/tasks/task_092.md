# Task ID: 92

**Title:** Frontend: Agent Configuration Form Updates

**Status:** done

**Dependencies:** 91 ✓

**Priority:** high

**Description:** Update the existing agent editor to use the new Model Library and Gateway settings.

**Details:**

1. Replace any existing free-text model input with the new `ModelSelect` component.
2. Remove any per-agent API key fields if they exist (enforcing org-level gateway).
3. Ensure `modelId` is saved to the agent configuration state.
4. Fetch the selected model's metadata to prepare for parameter validation in the next task.

**Test Strategy:**

Manual test: Create/Edit an agent, select a model from the new dropdown, save, and verify persistence.
