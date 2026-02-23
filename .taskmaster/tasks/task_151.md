# Task ID: 151

**Title:** Build API token management UI

**Status:** pending

**Dependencies:** 138 ✓, 147

**Priority:** high

**Description:** Create settings page for generating and managing API tokens used by MCP clients.

**Details:**

1. Create `apps/web/app/settings/api-tokens/page.tsx`
2. List existing tokens:
   - Token name
   - Created date
   - Last used date (if any)
   - Expires at (or 'Never')
   - Delete button
3. 'Create new token' form:
   - Token name input (e.g., 'Claude Code', 'My Laptop')
   - Optional expiration (never, 30 days, 90 days, 1 year)
   - Generate button
4. On create:
   - Generate secure random token with prefix 'sbot_'
   - Hash with bcrypt before storing
   - Show token ONCE in modal (cannot be retrieved again)
   - Copy to clipboard button
5. Create tRPC procedures in new `apps/web/server/routers/api-tokens.ts`:
   - listTokens(): get user's tokens (excluding hash)
   - createToken({ name, expiresIn? }): create and return raw token once
   - deleteToken({ id }): revoke token
6. Wire router into _app.ts

**Test Strategy:**

1. Navigate to /settings/api-tokens
2. Create new token
3. Verify token displayed only once
4. Verify token appears in list
5. Test delete token
6. Verify deleted token doesn't authenticate
