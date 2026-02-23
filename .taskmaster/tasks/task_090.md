# Task ID: 90

**Title:** Frontend: Gateway Settings Page

**Status:** done

**Dependencies:** 87 ✓, 89 ✓

**Priority:** medium

**Description:** Create an admin UI page to configure the LLM gateway.

**Details:**

1. Create a new route/page in the Admin settings area.
2. Add a form with: Provider (readonly/dropdown locked to OpenRouter), API Key (password input), Base URL (text input).
3. Add a 'Verify & Save' button that calls `POST /api/settings/gateway`.
4. Add a 'Refresh Models' button that calls `POST /api/models/refresh` manually.

**Test Strategy:**

Manual testing: Enter API key, save, refresh page to see if settings persist. Click refresh models and check network tab.
