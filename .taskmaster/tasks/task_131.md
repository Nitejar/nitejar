# Task ID: 131

**Title:** Integrate NetworkPolicySection into agent detail page

**Status:** done

**Dependencies:** 129 ✓, 130 ✓

**Priority:** medium

**Description:** Add the NetworkPolicySection component to the agent detail page layout, positioned appropriately among existing sections.

**Details:**

Modify `apps/web/app/admin/agents/[id]/page.tsx` to include the NetworkPolicySection:

```typescript
import { NetworkPolicySection } from './NetworkPolicySection';

export default async function AgentDetailPage({ params }: { params: { id: string } }) {
  // ... existing code
  
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Column */}
        <div className="lg:col-span-2 space-y-8">
          {/* Existing sections */}
          <IdentitySection agent={agent} />
          <SoulSection agent={agent} />
          <ModelSection agent={agent} />
          
          {/* New Network Policy Section - positioned after core config but before memory/session */}
          <NetworkPolicySection agentId={agent.id} />
          
          <MemorySection agent={agent} />
          <SessionSection agent={agent} />
          <DangerZone agent={agent} />
        </div>
        
        {/* Sidebar */}
        <div className="space-y-6">
          <IntegrationsCard agent={agent} />
          <DetailsCard agent={agent} />
        </div>
      </div>
    </div>
  );
}
```

Position rationale:
- After ModelSection because network policy is a runtime configuration
- Before MemorySection/SessionSection which are more advanced settings
- Follows the pattern of other full-width main column sections

Ensure the component is properly imported and the page continues to work with SSR by making NetworkPolicySection a client component (already done with 'use client').

**Test Strategy:**

1. Verify agent detail page loads without errors
2. Verify NetworkPolicySection appears in correct position
3. Test page renders correctly in responsive layouts (mobile, tablet, desktop)
4. Verify other sections continue to function correctly
5. Test navigation between agents updates the NetworkPolicySection
6. Use agent-browser skill to visually verify the section appears correctly
