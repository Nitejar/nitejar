# Task ID: 127

**Title:** Create networkPolicy tRPC router with CRUD endpoints

**Status:** done

**Dependencies:** 125 ✓, 126 ✓

**Priority:** high

**Description:** Implement tRPC router procedures for getting, setting, and listing network policies and presets, following the established patterns in the codebase.

**Details:**

Create new file `apps/web/server/routers/network-policy.ts`:

```typescript
import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { db, parseAgentConfig, serializeAgentConfig } from '@nitejar/database';
import {
  NetworkPolicy,
  NETWORK_POLICY_PRESETS,
  validateNetworkPolicy,
  getPresetById,
  DEFAULT_NETWORK_POLICY,
} from '@nitejar/agent';
import { syncAgentNetworkPolicy } from '@nitejar/sprites';

const networkPolicyRuleSchema = z.object({
  domain: z.string().min(1),
  action: z.enum(['allow', 'deny']),
});

const networkPolicySchema = z.object({
  mode: z.enum(['allow-list', 'deny-list', 'unrestricted']),
  rules: z.array(networkPolicyRuleSchema).min(1),
  presetId: z.string().optional(),
  customized: z.boolean().optional(),
});

export const networkPolicyRouter = router({
  // Get current policy for an agent
  get: publicProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input }) => {
      const agent = await db
        .selectFrom('agents')
        .select(['id', 'config', 'sprite_id'])
        .where('id', '=', input.agentId)
        .executeTakeFirst();
      
      if (!agent) throw new Error('Agent not found');
      
      const config = parseAgentConfig(agent.config);
      return {
        policy: config.networkPolicy || null,
        spriteId: agent.sprite_id,
      };
    }),

  // Set policy for an agent
  set: publicProcedure
    .input(z.object({
      agentId: z.string(),
      policy: networkPolicySchema,
    }))
    .mutation(async ({ input }) => {
      const validation = validateNetworkPolicy(input.policy as NetworkPolicy);
      if (!validation.valid) {
        throw new Error(`Invalid policy: ${validation.errors.join(', ')}`);
      }
      
      const agent = await db
        .selectFrom('agents')
        .select(['id', 'config', 'sprite_id'])
        .where('id', '=', input.agentId)
        .executeTakeFirst();
      
      if (!agent) throw new Error('Agent not found');
      
      const config = parseAgentConfig(agent.config);
      config.networkPolicy = input.policy as NetworkPolicy;
      
      await db
        .updateTable('agents')
        .set({ config: serializeAgentConfig(config) })
        .where('id', '=', input.agentId)
        .execute();
      
      // Sync to Sprites API if sprite exists
      let syncResult = { synced: false, error: undefined as string | undefined };
      if (agent.sprite_id) {
        syncResult = await syncAgentNetworkPolicy(agent.sprite_id, input.policy as NetworkPolicy);
      }
      
      return {
        success: true,
        synced: syncResult.synced,
        syncError: syncResult.error,
      };
    }),

  // List available presets
  listPresets: publicProcedure.query(async () => {
    return NETWORK_POLICY_PRESETS;
  }),

  // Apply a preset to an agent
  applyPreset: publicProcedure
    .input(z.object({
      agentId: z.string(),
      presetId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const preset = getPresetById(input.presetId);
      if (!preset) throw new Error(`Preset not found: ${input.presetId}`);
      
      const agent = await db
        .selectFrom('agents')
        .select(['id', 'config', 'sprite_id'])
        .where('id', '=', input.agentId)
        .executeTakeFirst();
      
      if (!agent) throw new Error('Agent not found');
      
      const config = parseAgentConfig(agent.config);
      config.networkPolicy = { ...preset.policy };
      
      await db
        .updateTable('agents')
        .set({ config: serializeAgentConfig(config) })
        .where('id', '=', input.agentId)
        .execute();
      
      // Sync to Sprites API
      let syncResult = { synced: false, error: undefined as string | undefined };
      if (agent.sprite_id) {
        syncResult = await syncAgentNetworkPolicy(agent.sprite_id, preset.policy);
      }
      
      return {
        success: true,
        preset: preset,
        synced: syncResult.synced,
        syncError: syncResult.error,
      };
    }),

  // Retry sync if local and remote are out of sync
  retrySync: publicProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ input }) => {
      const agent = await db
        .selectFrom('agents')
        .select(['id', 'config', 'sprite_id'])
        .where('id', '=', input.agentId)
        .executeTakeFirst();
      
      if (!agent) throw new Error('Agent not found');
      if (!agent.sprite_id) throw new Error('No sprite assigned to agent');
      
      const config = parseAgentConfig(agent.config);
      if (!config.networkPolicy) throw new Error('No network policy configured');
      
      const syncResult = await syncAgentNetworkPolicy(agent.sprite_id, config.networkPolicy);
      return syncResult;
    }),
});
```

Register in `apps/web/server/routers/_app.ts`:
```typescript
import { networkPolicyRouter } from './network-policy';

export const appRouter = router({
  // ... existing routers
  networkPolicy: networkPolicyRouter,
});
```

**Test Strategy:**

1. Test get procedure returns null policy for new agents
2. Test get procedure returns saved policy for configured agents
3. Test set procedure validates policy and rejects invalid ones
4. Test set procedure saves policy to database
5. Test set procedure calls Sprites sync and returns sync status
6. Test listPresets returns all presets with correct structure
7. Test applyPreset applies correct preset policy
8. Test applyPreset with invalid preset ID throws error
9. Test retrySync with no sprite assigned throws appropriate error
10. Integration test full flow: set policy, verify DB, verify Sprites sync called
