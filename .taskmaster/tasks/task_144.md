# Task ID: 144

**Title:** Build forgot-password and reset-password pages

**Status:** pending

**Dependencies:** 140 ✓, 142 ✓

**Priority:** high

**Description:** Create password reset flow pages for users who forgot their password.

**Details:**

1. Create `apps/web/app/(auth)/forgot-password/page.tsx`:
   - Email input form
   - Submit triggers authClient.forgetPassword({ email })
   - Success message: 'If an account exists, you will receive a reset email'
   - Link back to sign-in
2. Create `apps/web/app/(auth)/reset-password/page.tsx`:
   - Accept token via query param: /reset-password?token=xxx
   - Validate token on load
   - New password input with requirements
   - Confirm password input
   - Submit calls authClient.resetPassword({ token, newPassword })
   - Success redirects to /sign-in with message
3. Handle errors: invalid token, expired token, password requirements
4. Style consistent with other auth pages

**Test Strategy:**

1. Test forgot-password form submission
2. Verify reset email received
3. Test reset-password with valid token
4. Test invalid/expired token handling
5. Test successful password reset allows sign-in
