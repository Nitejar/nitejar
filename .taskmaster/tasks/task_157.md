# Task ID: 157

**Title:** Add two-factor authentication plugin

**Status:** pending

**Dependencies:** 145 ✓

**Priority:** low

**Description:** Configure better-auth's TOTP-based two-factor authentication plugin.

**Details:**

1. Import twoFactor from 'better-auth/plugins'
2. Update `apps/web/lib/auth.ts`:
   ```typescript
   plugins: [
     twoFactor({
       issuer: 'Nitejar',
       totpOptions: { digits: 6, period: 30 }
     })
   ]
   ```
3. Add twoFactorClient to auth-client.ts
4. Migration adds twoFactor table (better-auth handles this)
5. Create database migration if needed for backup codes storage

**Test Strategy:**

1. Verify twoFactor table created
2. Test plugin loads without error
3. Test client exports 2FA methods
