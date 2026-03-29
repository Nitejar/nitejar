import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { findAgentById } from '@nitejar/database'
import {
  createEphemeralSandboxForAgent,
  deleteAgentSandboxByName,
  listAgentSandboxesWithStale,
} from '@nitejar/agent/sandboxes'
import { publicProcedure, router } from '../trpc'

export const sandboxesRouter = router({
  list: publicProcedure.input(z.object({ agentId: z.string() })).query(async ({ input }) => {
    const agent = await findAgentById(input.agentId)
    if (!agent) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
    }

    const sandboxes = await listAgentSandboxesWithStale(agent.id)

    return {
      sandboxes,
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
})

export type SandboxesRouter = typeof sandboxesRouter
