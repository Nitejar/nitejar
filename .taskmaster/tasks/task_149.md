# Task ID: 149

**Title:** Build sessions management page

**Status:** pending

**Dependencies:** 147

**Priority:** medium

**Description:** Create page to view and revoke active sessions.

**Details:**

1. Create `apps/web/app/settings/sessions/page.tsx`
2. List all active sessions for current user:
   - Session ID (partial)
   - IP address
   - User agent (browser/device)
   - Created/last active time
   - 'Current session' badge for active session
3. Add 'Revoke' button for each session (except current)
4. Add 'Revoke all other sessions' button
5. Use authClient.listSessions() and authClient.revokeSession()
6. Confirm dialog before revoking
7. Auto-refresh list after revocation

**Test Strategy:**

1. View sessions list shows current session
2. Sign in from another browser/incognito
3. Verify second session appears in list
4. Test revoking other session
5. Test 'revoke all' functionality
6. Verify revoked session cannot access protected routes
