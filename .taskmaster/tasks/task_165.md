# Task ID: 165

**Title:** Add sign-out functionality

**Status:** done

**Dependencies:** 145 ✓

**Priority:** medium

**Description:** Add sign-out button to admin header and implement sign-out flow.

**Details:**

1. Update admin layout header to show current user info
2. Add user dropdown menu:
   - Display user name and avatar
   - Link to /settings
   - Sign out button
3. Implement sign-out:
   - Call authClient.signOut()
   - Redirect to /sign-in
   - Clear any client-side state
4. Use shadcn/ui DropdownMenu component
5. Show loading state during sign-out

**Test Strategy:**

1. Verify user info displayed in header
2. Click sign out
3. Verify session cleared
4. Verify redirect to sign-in
5. Verify protected routes no longer accessible
