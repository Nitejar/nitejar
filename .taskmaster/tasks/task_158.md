# Task ID: 158

**Title:** Build 2FA setup UI in security settings

**Status:** pending

**Dependencies:** 148, 157

**Priority:** low

**Description:** Add UI for enabling, verifying, and managing two-factor authentication.

**Details:**

1. Update `apps/web/app/settings/security/page.tsx`
2. Add 2FA section:
   - Current status: Enabled/Disabled
   - Enable button (if disabled)
   - Disable button (if enabled, requires password)
3. Enable flow:
   - Call authClient.twoFactor.enable()
   - Display QR code from returned URI
   - Show manual entry key
   - Verify code input (6 digits)
   - Call authClient.twoFactor.verifyTotp({ code })
4. After enabling:
   - Generate and display backup codes
   - Require user to confirm they've saved codes
5. Disable flow:
   - Require password confirmation
   - Call authClient.twoFactor.disable({ password })
6. Add recovery codes regeneration option

**Test Strategy:**

1. Enable 2FA - scan QR with authenticator app
2. Verify code from app works
3. Backup codes displayed
4. Sign out and sign in - 2FA required
5. Use backup code for recovery
6. Disable 2FA - verify no longer required on login
