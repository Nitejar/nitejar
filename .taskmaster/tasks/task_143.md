# Task ID: 143

**Title:** Build accept-invitation page

**Status:** done

**Dependencies:** 141 ✓, 142 ✓

**Priority:** high

**Description:** Create page for invited users to accept invitation and set their password.

**Details:**

1. Create `apps/web/app/(auth)/accept-invitation/page.tsx`
2. Accept token via URL query param: /accept-invitation?token=xxx
3. Validate token on load, show error if invalid/expired
4. Build form with:
   - Display invited email (read-only)
   - Name input (editable)
   - Password input with requirements
   - Confirm password input
5. On submit, call authClient.invitation.acceptInvitation({ token, name, password })
6. Handle errors: expired token, already accepted, password too weak
7. On success, auto-login and redirect to /admin
8. Style consistent with sign-in page

**Test Strategy:**

1. Access page with valid token
2. Test invalid/expired token shows error
3. Test password validation (min length, requirements)
4. Test password mismatch error
5. Test successful acceptance creates user and logs in
