# Task ID: 152

**Title:** Implement API token validation in MCP server

**Status:** done

**Dependencies:** 150 ✓, 151

**Priority:** high

**Description:** Add token validation logic to MCP server that verifies API tokens against the database.

**Details:**

1. Create `packages/mcp-server/src/auth/token.ts`:
   - Function `validateToken(token: string): Promise<User | null>`
   - Parse token format (expect 'sbot_xxx')
   - Query api_tokens table for matching token_hash (bcrypt.compare)
   - Check expires_at if set
   - Update last_used_at on successful validation
   - Join to get user details (id, name, email, role)
   - Return user object or null
2. Create `packages/mcp-server/src/auth/context.ts`:
   - AuthContext type with user and isAuthenticated
   - createAuthContext(token?: string) factory
3. Store current auth context in server state
4. Add requireAuth wrapper for tools that need authentication

**Test Strategy:**

1. Test validateToken with valid token returns user
2. Test validateToken with invalid token returns null
3. Test expired token returns null
4. Test last_used_at is updated
5. Test bcrypt comparison is timing-safe
