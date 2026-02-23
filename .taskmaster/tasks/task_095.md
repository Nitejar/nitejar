# Task ID: 95

**Title:** System: Automated Model Cache Refresh

**Status:** done

**Dependencies:** 89 ✓

**Priority:** low

**Description:** Set up a background job or periodic check to refresh model metadata automatically.

**Details:**

1. Implement a scheduler (e.g., cron job or check-on-access logic) to run `fetchOpenRouterModels`.
2. Configure TTL to 24 hours.
3. Ensure the refresh happens asynchronously so it doesn't block user requests.
4. Log success/failure of background refreshes.

**Test Strategy:**

Simulate time passage or force stale cache state, trigger system check, verify database is updated without user intervention.
