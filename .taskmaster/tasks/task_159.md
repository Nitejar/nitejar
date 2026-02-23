# Task ID: 159

**Title:** Update sign-in flow for 2FA

**Status:** pending

**Dependencies:** 142 ✓, 158

**Priority:** low

**Description:** Modify sign-in page to handle two-factor authentication challenge.

**Details:**

1. Update `apps/web/app/(auth)/sign-in/page.tsx`
2. After password auth, check if 2FA required:
   - If signIn returns twoFactorRequired: true, show 2FA step
3. Add 2FA verification form:
   - 6-digit code input (OTP style)
   - 'Use backup code' link
   - Submit verifies TOTP
4. Backup code flow:
   - Switch to backup code input
   - Warn that backup codes are single-use
5. Handle errors: invalid code, no more backup codes
6. On successful 2FA, complete login and redirect

**Test Strategy:**

1. Sign in with 2FA enabled account
2. Verify 2FA prompt appears after password
3. Enter valid TOTP - verify login completes
4. Enter invalid TOTP - verify error
5. Use backup code - verify works and is consumed
