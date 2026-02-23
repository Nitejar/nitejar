# Task ID: 154

**Title:** Implement MCP agent read tools

**Status:** done

**Dependencies:** 152 ✓, 153 ✓

**Priority:** high

**Description:** Create MCP tools for listing and viewing agents the user has access to.

**Details:**

1. Create `packages/mcp-server/src/tools/agents.ts`
2. Implement `list_agents` tool:
   - Require authentication
   - Input: { team_id?: string, status?: string }
   - Query logic:
     - If user.role is 'superadmin' or 'admin': return all agents
     - Else: return agents in user's teams (via nitejar_user_id -> team_members -> agent_teams)
   - Apply optional filters
   - Return: id, handle, name, title, emoji, status, team info
3. Implement `get_agent` tool:
   - Require authentication
   - Input: { id?: string, handle?: string } (one required)
   - Verify user has access to agent
   - Return full agent details: id, handle, name, title, emoji, avatar_url, status, soul, model, teams, created_at, updated_at
4. Create access control helper `canAccessAgent(user, agentId)`
5. Register tools in server.ts

**Test Strategy:**

1. Unauthenticated call returns error
2. Admin can list all agents
3. Member only sees team's agents
4. get_agent with valid access returns details
5. get_agent without access returns error
6. Filter by team_id works
7. Filter by status works
