# Task ID: 153

**Title:** Implement MCP auth tools

**Status:** done

**Dependencies:** 152 ✓

**Priority:** high

**Description:** Create the authentication-related MCP tools: auth_login, auth_set_token, auth_whoami, auth_logout.

**Details:**

1. Create `packages/mcp-server/src/tools/auth.ts`
2. Implement tools:
   - `auth_login`: Returns URL to /settings/api-tokens with instructions
   - `auth_set_token`: Validates token, stores in context, returns user info
   - `auth_whoami`: Returns current auth state (user details or not authenticated)
   - `auth_logout`: Clears token from context
3. Register tools in server.ts with MCP SDK:
   ```typescript
   server.setRequestHandler(ListToolsRequestSchema, () => ({
     tools: [
       { name: 'auth_login', description: '...', inputSchema: {...} },
       // etc.
     ]
   }))
   ```
4. Handle tool calls in CallToolRequestSchema handler
5. Tools should be stateful within session (token persists until logout)

**Test Strategy:**

1. Call auth_login - verify returns correct URL
2. Call auth_set_token with valid token - verify user returned
3. Call auth_whoami - verify shows authenticated user
4. Call auth_logout - verify clears auth
5. Call auth_whoami again - verify not authenticated
