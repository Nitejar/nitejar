# Task ID: 160

**Title:** Implement MCP soul editing tool

**Status:** done

**Dependencies:** 155 ✓

**Priority:** low

**Description:** Add MCP tool for updating agent soul/identity documents.

**Details:**

1. Add `update_agent_soul` tool to agents.ts
2. Tool spec:
   - Require authentication
   - Input: { id: string, soul: string }
   - Verify user has access to agent
   - Validate soul content (max length, no dangerous content)
   - Update agent.config with new soul
   - Return updated agent
3. Access control: same as update_agent (team members can edit)
4. Log to audit_logs with event_type 'soul_updated'
5. Consider adding soul history/versioning in future

**Test Strategy:**

1. Update soul via MCP
2. Verify soul persisted in database
3. Verify agent uses new soul in prompts
4. Audit log entry created
5. Unauthorized access rejected
