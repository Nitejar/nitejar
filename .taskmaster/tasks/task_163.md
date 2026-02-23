# Task ID: 163

**Title:** Enhance audit logging for MCP operations

**Status:** done

**Dependencies:** 155 ✓, 160 ✓, 161 ✓, 162

**Priority:** low

**Description:** Ensure all MCP operations are properly logged to the audit_logs table.

**Details:**

1. Create audit logging utility in MCP server:
   ```typescript
   async function logAudit({
     eventType,
     agentId,
     userId,
     metadata
   })
   ```
2. Standardize event types:
   - 'mcp.agent.read' - agent viewed
   - 'mcp.agent.updated' - identity fields changed
   - 'mcp.agent.soul_updated' - soul changed
   - 'mcp.agent.model_updated' - model config changed
   - 'mcp.auth.token_used' - token validated
3. Include in metadata:
   - user_id, user_email
   - changed_fields for updates
   - previous_value, new_value for sensitive changes
   - ip_address if available
4. Update all MCP tools to call logAudit
5. Add tRPC query in admin to view recent audit logs

**Test Strategy:**

1. Perform MCP operations
2. Query audit_logs table
3. Verify all operations logged
4. Verify metadata is complete
5. Admin UI shows audit trail
