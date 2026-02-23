# Task ID: 93

**Title:** Frontend: Advanced Parameter Controls with Validation

**Status:** done

**Dependencies:** 92 ✓

**Priority:** medium

**Description:** Implement UI for configuring model parameters with constraints based on selected model.

**Details:**

1. Add basic fields: Temperature (slider/input), Max Tokens (number).
2. Add collapsible 'Advanced' section containing: Top P, Frequency Penalty, Presence Penalty, Seed, Stop sequences.
3. Implement validation logic: Restrict Max Tokens based on the selected model's context length (from `model_catalog` metadata).
4. Disable/Hide parameters not supported by the selected model if indicated in metadata.

**Test Strategy:**

Unit test: Select a model with 4k context, try to set max tokens to 8k, verify validation error.
