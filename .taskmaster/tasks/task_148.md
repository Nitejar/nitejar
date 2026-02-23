# Task ID: 148

**Title:** Build security settings page with password change

**Status:** pending

**Dependencies:** 147

**Priority:** medium

**Description:** Create security settings page for changing password.

**Details:**

1. Create `apps/web/app/settings/security/page.tsx`
2. Change password form:
   - Current password input
   - New password input with requirements
   - Confirm new password input
   - Submit button
3. Use authClient.changePassword({ currentPassword, newPassword })
4. Handle errors: incorrect current password, password requirements
5. Show success message on update
6. Placeholder section for 2FA (Phase 2) with 'Coming Soon' badge

**Test Strategy:**

1. Test change password with wrong current password
2. Test password requirements validation
3. Test successful password change
4. Verify can sign in with new password
5. Verify old password no longer works
