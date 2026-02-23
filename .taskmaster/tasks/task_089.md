# Task ID: 89

**Title:** Backend: Model Caching and Refresh API

**Status:** done

**Dependencies:** 86 ✓, 88 ✓

**Priority:** high

**Description:** Implement logic to cache fetched models into the database and expose endpoints for the frontend.

**Details:**

1. Implement `POST /api/models/refresh` that triggers the OpenRouter fetch service.
2. Upsert fetched models into the `model_catalog` table, updating `refreshed_at` timestamp.
3. Implement `GET /api/models` to return models from the DB. If the table is empty or data is stale (>24h), trigger a background refresh.
4. Logic to tag models as 'curated' based on a predefined list (e.g., GPT-4, Claude 3.5 Sonnet, Llama 3).

**Test Strategy:**

Integration test: Call refresh endpoint, verify DB is populated. Call list endpoint, verify JSON structure.
