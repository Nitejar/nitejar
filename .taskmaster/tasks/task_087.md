# Task ID: 87

**Title:** Backend: Gateway Configuration API

**Status:** done

**Dependencies:** 86 ✓

**Priority:** high

**Description:** Implement API endpoints to manage organization-level gateway settings.

**Details:**

1. Create `GET /api/settings/gateway` to fetch current configuration (excluding full API key, return masked or exists flag).
2. Create `POST /api/settings/gateway` to update provider (OpenRouter only initially), API key, and base URL.
3. Implement encryption/decryption logic for the API key using existing project helpers.
4. Add validation ensuring only 'openrouter' is accepted as the provider for now.

**Test Strategy:**

Unit tests for encryption/decryption. Integration tests for GET/POST endpoints ensuring data persistence.
