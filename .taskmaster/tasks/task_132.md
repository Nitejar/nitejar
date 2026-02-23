# Task ID: 132

**Title:** Apply default network policy on agent creation

**Status:** done

**Dependencies:** 127 ✓

**Priority:** medium

**Description:** Modify the agent creation flow to automatically apply the 'development' preset as the default network policy for new agents.

**Details:**

Modify the createAgent procedure in `apps/web/server/routers/org.ts` to include the default network policy:

```typescript
import { DEFAULT_NETWORK_POLICY } from '@nitejar/agent';
import { syncAgentNetworkPolicy } from '@nitejar/sprites';

// In createAgent mutation:
createAgent: publicProcedure
  .input(z.object({
    handle: z.string().min(1).max(32),
    name: z.string().min(1),
    title: z.string().optional(),
    emoji: z.string().optional(),
    avatarUrl: z.string().optional(),
    teamId: z.string().optional(),
  }))
  .mutation(async ({ input }) => {
    const id = generateId();
    
    // Build initial config with default network policy
    const config: AgentConfig = {
      title: input.title,
      emoji: input.emoji,
      avatarUrl: input.avatarUrl,
      networkPolicy: DEFAULT_NETWORK_POLICY,
    };
    
    await db
      .insertInto('agents')
      .values({
        id,
        handle: input.handle,
        name: input.name,
        config: serializeAgentConfig(config),
        status: 'idle',
        team_id: input.teamId || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();
    
    // Note: Sprites sync happens later when sprite is provisioned
    // (sprite_id is null on new agents)
    
    return { id, handle: input.handle };
  }),
```

Also, when a sprite is provisioned for an agent (wherever that happens in the codebase), ensure the network policy is synced:

```typescript
// In sprite provisioning logic:
async function provisionSpriteForAgent(agentId: string) {
  const agent = await db.selectFrom('agents').where('id', '=', agentId).executeTakeFirst();
  if (!agent) throw new Error('Agent not found');
  
  // Create sprite...
  const sprite = await getOrCreateSprite(agent.handle, { /* options */ });
  
  // Update agent with sprite_id
  await db
    .updateTable('agents')
    .set({ sprite_id: sprite.name })
    .where('id', '=', agentId)
    .execute();
  
  // Sync network policy if configured
  const config = parseAgentConfig(agent.config);
  if (config.networkPolicy) {
    await syncAgentNetworkPolicy(sprite.name, config.networkPolicy);
  }
}
```

Locate the sprite provisioning code and add the policy sync call.

**Test Strategy:**

1. Test creating new agent includes networkPolicy in config
2. Verify default policy is 'development' preset with correct rules
3. Test that existing agents without networkPolicy continue to work
4. Test sprite provisioning syncs network policy to Sprites API
5. Integration test: create agent, provision sprite, verify policy applied
6. Test error handling if Sprites sync fails during provisioning
