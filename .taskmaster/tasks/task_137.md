# Task ID: 137

**Title:** Install and configure better-auth core

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Install better-auth package and create the core auth configuration with email+password authentication support.

**Details:**

1. Install better-auth: `pnpm add better-auth --filter @nitejar/web`
2. Create `apps/web/lib/auth.ts` with betterAuth configuration:
   - Use existing SQLite database path (./data/nitejar.db)
   - Enable emailAndPassword with requireEmailVerification: false
   - Configure session settings (7 day expiry, 24h update age)
   - Add custom user fields to match existing schema: role (string, default 'member'), status (string, default 'active')
3. Create `apps/web/lib/auth-client.ts` for React client:
   - Use createAuthClient from better-auth/react
   - Export signIn, signUp, signOut, useSession
   - Set baseURL from NEXT_PUBLIC_APP_URL
4. Add env vars to .env.example: BETTER_AUTH_SECRET, BETTER_AUTH_URL
5. Generate BETTER_AUTH_SECRET with `openssl rand -base64 32`

**Test Strategy:**

1. Import auth config without errors
2. Verify betterAuth instance initializes
3. Check auth-client exports work in browser environment
4. Run `pnpm typecheck` to ensure no type errors
