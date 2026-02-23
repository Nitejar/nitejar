# Task ID: 155

**Title:** Implement MCP agent update tool

**Status:** done

**Dependencies:** 154 ✓

**Priority:** high

**Description:** Create MCP tool for updating agent identity fields (name, title, emoji, avatar).

**Details:**

1. Add `update_agent` tool to `packages/mcp-server/src/tools/agents.ts`
2. Tool spec:
   - Require authentication
   - Input: { id: string, updates: { name?, title?, emoji?, avatar_url? } }
   - Verify user has access to agent (same logic as get_agent)
   - Validate inputs (non-empty strings, valid URL for avatar)
   - Update agent via database
   - Return: { success: boolean, agent: updated agent }
3. Create access control helper `canUpdateAgent(user, agentId)` - same as access for now
4. Log update to audit_logs table with event_type 'agent_updated', metadata containing changed fields and user_id
5. Register tool in server.ts

**Test Strategy:**

1. Update agent name - verify persisted
2. Update title and emoji together - verify both changed
3. Invalid avatar URL rejected
4. User without access gets error
5. Audit log entry created
6. Changes visible in admin UI
