import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { findAgentById, updateAgent } from '@nitejar/database'
import {
  createEphemeralSandboxForAgent,
  deleteAgentSandboxByName,
  listAgentSandboxesWithStale,
} from '@nitejar/agent/sandboxes'
import { parseAgentConfig, serializeAgentConfig } from '@nitejar/agent/config'
import { publicProcedure, router } from '../trpc'

export const sandboxesRouter = router({
  list: publicProcedure.input(z.object({ agentId: z.string() })).query(async ({ input }) => {
    const agent = await findAgentById(input.agentId)
    if (!agent) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
    }

    const config = parseAgentConfig(agent.config)
    const sandboxes = await listAgentSandboxesWithStale(agent.id)

    return {
      sandboxes,
      allowEphemeralSandboxCreation: config.allowEphemeralSandboxCreation === true,
      allowRoutineManagement: config.allowRoutineManagement === true,
      dangerouslyUnrestricted: config.dangerouslyUnrestricted === true,
    }
  }),

  createEphemeral: publicProcedure
    .input(
      z.object({
        agentId: z.string(),
        name: z.string().trim().min(1),
        description: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const agent = await findAgentById(input.agentId)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }

      try {
        const sandbox = await createEphemeralSandboxForAgent(agent.id, {
          name: input.name,
          description: input.description,
          createdBy: 'admin',
        })
        return { sandbox }
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to create sandbox',
        })
      }
    }),

  delete: publicProcedure
    .input(
      z.object({
        agentId: z.string(),
        sandboxName: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const agent = await findAgentById(input.agentId)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }

      try {
        const sandbox = await deleteAgentSandboxByName(agent.id, input.sandboxName)
        return { deleted: true, sandbox }
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to delete sandbox',
        })
      }
    }),

  setEphemeralCreationPolicy: publicProcedure
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      const agent = await findAgentById(input.agentId)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }

      const current = parseAgentConfig(agent.config)
      const updatedConfig = serializeAgentConfig({
        ...current,
        allowEphemeralSandboxCreation: input.enabled,
      })

      await updateAgent(agent.id, { config: updatedConfig })
      return { ok: true, enabled: input.enabled }
    }),

  setRoutineManagementPolicy: publicProcedure
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      const agent = await findAgentById(input.agentId)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }

      const current = parseAgentConfig(agent.config)
      const updatedConfig = serializeAgentConfig({
        ...current,
        allowRoutineManagement: input.enabled,
      })

      await updateAgent(agent.id, { config: updatedConfig })
      return { ok: true, enabled: input.enabled }
    }),

  setDangerouslyUnrestrictedPolicy: publicProcedure
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      const agent = await findAgentById(input.agentId)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }

      const current = parseAgentConfig(agent.config)
      const updatedConfig = serializeAgentConfig({
        ...current,
        dangerouslyUnrestricted: input.enabled,
      })

      await updateAgent(agent.id, { config: updatedConfig })
      return { ok: true, enabled: input.enabled }
    }),
})

export type SandboxesRouter = typeof sandboxesRouter
