# Task ID: 138

**Title:** Create better-auth database migration

**Status:** done

**Dependencies:** 137 ✓

**Priority:** high

**Description:** Create migration for better-auth tables (user, session, account, verification) plus api_tokens table for MCP authentication.

**Details:**

1. Create migration `packages/database/migrations/20260205_010000_better_auth.ts`
2. Create better-auth tables:
   - `user` table: id, name, email, emailVerified, image, createdAt, updatedAt, role (default 'member'), status (default 'active'), nitejar_user_id (nullable, links to existing users table)
   - `session` table: id, expiresAt, ipAddress, userAgent, userId (FK to user)
   - `account` table: id, accountId, providerId, userId (FK), accessToken, refreshToken, idToken, expiresAt, password
   - `verification` table: id, identifier, value, expiresAt
3. Create `api_tokens` table for MCP auth:
   - id (text, PK), user_id (text, FK to user), name (text), token_hash (text, unique), last_used_at (integer, nullable), expires_at (integer, nullable), created_at (integer)
4. Add necessary indexes on userId fields and token_hash
5. Update `packages/database/src/types.ts` with new table interfaces
6. Export types: BetterAuthUser, BetterAuthSession, BetterAuthAccount, ApiToken

**Test Strategy:**

1. Run migration with `pnpm db:migrate`
2. Verify tables created with correct schema using sqlite3 CLI
3. Check foreign key constraints work
4. Verify types compile with `pnpm typecheck`
