# Task ID: 88

**Title:** Backend: OpenRouter Model Fetching Service

**Status:** done

**Dependencies:** 87 ✓

**Priority:** high

**Description:** Implement a service to fetch models from OpenRouter API and normalize the data.

**Details:**

1. Create a service/utility function `fetchOpenRouterModels`.
2. Call `https://openrouter.ai/api/v1/models`.
3. Map the response to a standardized internal format including: context length, modalities, pricing (if available), and tool support.
4. Define a fallback list of curated models (hardcoded JSON) to use if the API call fails.

**Test Strategy:**

Unit test with mocked OpenRouter API response. Verify fallback logic triggers on API failure.
