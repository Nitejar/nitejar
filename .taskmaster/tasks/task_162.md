# Task ID: 162

**Title:** Implement MCP team tools

**Status:** pending

**Dependencies:** 154 ✓

**Priority:** low

**Description:** Add MCP tools for listing teams and viewing team details.

**Details:**

1. Create `packages/mcp-server/src/tools/teams.ts`
2. Implement `list_teams` tool:
   - Require authentication
   - Returns teams user belongs to (via nitejar_user_id -> team_members)
   - Include: id, name, description, role in team, agent_count, member_count
3. Implement `get_team` tool:
   - Require authentication
   - Input: { id: string }
   - Verify user is member of team
   - Return: id, name, description, agents list, members list
4. Register tools in server.ts

**Test Strategy:**

1. list_teams returns user's teams
2. Admin sees all teams
3. get_team returns correct details
4. Unauthorized team access rejected
5. Counts are accurate
