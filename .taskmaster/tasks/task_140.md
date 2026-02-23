# Task ID: 140

**Title:** Extend email provider for password reset

**Status:** done

**Dependencies:** 137 ✓

**Priority:** high

**Description:** Extend existing Resend email setup to support password reset emails and update better-auth config to use it.

**Details:**

1. Create `apps/web/emails/PasswordResetEmail.tsx` React email template:
   - Include reset link with token
   - Style consistent with InviteEmail
   - Include expiration notice (1 hour)
2. Add `sendPasswordResetEmail` function to `apps/web/lib/email.tsx`:
   - Accept { to, resetUrl } params
   - Use Resend to send
   - Subject: 'Reset your Nitejar password'
3. Update auth config in `apps/web/lib/auth.ts`:
   - Add sendResetPassword callback that calls sendPasswordResetEmail
   - Construct URL from APP_BASE_URL + /reset-password?token=xxx
4. Add resetPassword config to better-auth with tokenExpiresIn: 3600 (1 hour)

**Test Strategy:**

1. Trigger password reset via API
2. Verify email sent (check Resend dashboard or logs)
3. Verify email contains correct reset URL
4. Test token expiration logic
