import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { findAgentById, updateAgent } from '@nitejar/database'
import {
  getPresetById,
  NETWORK_POLICY_PRESETS,
  toSpriteNetworkPolicy,
  validateNetworkPolicy,
} from '@nitejar/agent/network-policy'
import { parseAgentConfig, serializeAgentConfig } from '@nitejar/agent/config'
import type { NetworkPolicy } from '@nitejar/agent/types'
import { syncAgentNetworkPolicy } from '@nitejar/sprites'
import { protectedProcedure, router } from '../trpc'

const networkPolicyRuleSchema = z.object({
  domain: z.string().trim().min(1),
  action: z.enum(['allow', 'deny']),
})

const networkPolicySchema = z.object({
  mode: z.enum(['allow-list', 'deny-list', 'unrestricted']),
  rules: z.array(networkPolicyRuleSchema).min(1),
  presetId: z.string().optional(),
  customized: z.boolean().optional(),
})

function clonePolicy(policy: NetworkPolicy): NetworkPolicy {
  return {
    ...policy,
    rules: policy.rules.map((rule) => ({ ...rule })),
  }
}

export const networkPolicyRouter = router({
  get: protectedProcedure.input(z.object({ agentId: z.string() })).query(async ({ input }) => {
    const agent = await findAgentById(input.agentId)
    if (!agent) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
    }

    const config = parseAgentConfig(agent.config)
    return {
      policy: config.networkPolicy ?? null,
      spriteId: agent.sprite_id,
    }
  }),

  set: protectedProcedure
    .input(
      z.object({
        agentId: z.string(),
        policy: networkPolicySchema,
      })
    )
    .mutation(async ({ input }) => {
      const policy = clonePolicy(input.policy)
      const validation = validateNetworkPolicy(policy)
      if (!validation.valid) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid policy: ${validation.errors.join(', ')}`,
        })
      }

      const agent = await findAgentById(input.agentId)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }

      const config = parseAgentConfig(agent.config)
      const configJson = serializeAgentConfig({
        ...config,
        networkPolicy: policy,
      })
      await updateAgent(input.agentId, { config: configJson })

      const syncResult = await syncAgentNetworkPolicy(
        agent.sprite_id,
        toSpriteNetworkPolicy(policy)
      )

      return {
        success: true,
        synced: syncResult.synced,
        syncError: syncResult.error,
      }
    }),

  listPresets: protectedProcedure.query(() => {
    return NETWORK_POLICY_PRESETS.map((preset) => ({
      ...preset,
      policy: clonePolicy(preset.policy),
    }))
  }),

  applyPreset: protectedProcedure
    .input(
      z.object({
        agentId: z.string(),
        presetId: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const preset = getPresetById(input.presetId)
      if (!preset) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Preset not found: ${input.presetId}`,
        })
      }

      const agent = await findAgentById(input.agentId)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }

      const policy = clonePolicy(preset.policy)
      const config = parseAgentConfig(agent.config)
      const configJson = serializeAgentConfig({
        ...config,
        networkPolicy: policy,
      })
      await updateAgent(input.agentId, { config: configJson })

      const syncResult = await syncAgentNetworkPolicy(
        agent.sprite_id,
        toSpriteNetworkPolicy(policy)
      )

      return {
        success: true,
        preset: {
          ...preset,
          policy,
        },
        synced: syncResult.synced,
        syncError: syncResult.error,
      }
    }),

  retrySync: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ input }) => {
      const agent = await findAgentById(input.agentId)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }
      if (!agent.sprite_id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No sprite assigned to agent',
        })
      }

      const config = parseAgentConfig(agent.config)
      if (!config.networkPolicy) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No network policy configured',
        })
      }

      return syncAgentNetworkPolicy(agent.sprite_id, toSpriteNetworkPolicy(config.networkPolicy))
    }),
})
