# Task ID: 161

**Title:** Implement MCP model configuration tool

**Status:** done

**Dependencies:** 155 ✓

**Priority:** low

**Description:** Add MCP tool for admin-only model configuration changes.

**Details:**

1. Add `update_agent_model` tool to agents.ts
2. Tool spec:
   - Require authentication
   - Require admin or superadmin role
   - Input: { id: string, model: string, temperature?: number, maxTokens?: number }
   - Validate model exists in model_catalog
   - Validate temperature (0-2) and maxTokens (positive int)
   - Update agent config
3. Access control function `canUpdateAgentModel(user)` - admin/superadmin only
4. Log to audit_logs with event_type 'model_updated'
5. Return warning if model is paid/high-cost

**Test Strategy:**

1. Admin can update model
2. Member cannot update model (error)
3. Invalid model rejected
4. Temperature/maxTokens validation works
5. Audit log entry created
