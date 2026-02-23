# Task ID: 91

**Title:** Frontend: Reusable Model Select Component

**Status:** done

**Dependencies:** 89 ✓

**Priority:** high

**Description:** Build a specialized dropdown component for selecting models with grouped tabs.

**Details:**

1. Create `ModelSelect` component accepting `value` and `onChange`.
2. Fetch model list from `GET /api/models`.
3. Implement two tabs/sections inside the dropdown: 'Recommended' (filtered by `is_curated`) and 'All Models' (searchable).
4. Display metadata in the dropdown items (Provider, Context window badges).

**Test Strategy:**

Component testing (Storybook or unit test): Verify searching filters the list, tabs switch views, and selection returns model ID.
