# Task ID: 133

**Title:** Add policy status indicator to agent list view

**Status:** done

**Dependencies:** 131 ✓

**Priority:** low

**Description:** Add a visual indicator in the agents list showing each agent's network policy status (unrestricted, preset name, or custom).

**Details:**

Modify the agents list view to show network policy status. First, update the listAgents procedure to include policy info:

```typescript
// In apps/web/server/routers/org.ts listAgents:
listAgents: publicProcedure.query(async () => {
  const agents = await db
    .selectFrom('agents')
    .selectAll()
    .orderBy('created_at', 'desc')
    .execute();
  
  return agents.map((agent) => {
    const config = parseAgentConfig(agent.config);
    return {
      ...agent,
      config,
      // Add computed policy status
      policyStatus: getPolicyStatus(config.networkPolicy),
    };
  });
}),

// Helper function:
function getPolicyStatus(policy?: NetworkPolicy): {
  label: string;
  type: 'unrestricted' | 'preset' | 'custom' | 'none';
} {
  if (!policy) {
    return { label: 'None', type: 'none' };
  }
  if (policy.presetId && !policy.customized) {
    return {
      label: NETWORK_POLICY_PRESETS.find(p => p.id === policy.presetId)?.name || policy.presetId,
      type: 'preset',
    };
  }
  if (policy.mode === 'unrestricted') {
    return { label: 'Unrestricted', type: 'unrestricted' };
  }
  return { label: 'Custom', type: 'custom' };
}
```

Then update the agent list UI component (likely in `apps/web/app/admin/agents/page.tsx` or a table component):

```typescript
// In agent list row/card:
<div className="flex items-center gap-2">
  {/* Existing agent info */}
  <span className="text-gray-900 font-medium">{agent.name}</span>
  
  {/* Network Policy Badge */}
  <PolicyStatusBadge status={agent.policyStatus} />
</div>

function PolicyStatusBadge({ status }: { status: { label: string; type: string } }) {
  const styles = {
    unrestricted: 'bg-yellow-100 text-yellow-800',
    preset: 'bg-blue-100 text-blue-800',
    custom: 'bg-purple-100 text-purple-800',
    none: 'bg-gray-100 text-gray-600',
  };
  
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${styles[status.type as keyof typeof styles]}`}>
      {status.type === 'unrestricted' && '⚠️ '}
      {status.label}
    </span>
  );
}
```

The badge provides:
- Quick visual scan of policy states across agents
- Warning indicator for unrestricted agents (security concern)
- Distinct styling for presets vs custom configurations

**Test Strategy:**

1. Test listAgents returns policyStatus for each agent
2. Test getPolicyStatus returns correct labels for each scenario
3. Test badge renders with correct color for each policy type
4. Test warning emoji appears for unrestricted policies
5. Visual test with agent-browser to verify badges appear in list view
6. Test list view performance is not degraded by additional processing
