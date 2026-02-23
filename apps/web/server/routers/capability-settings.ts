import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../trpc'
import {
  getCapabilitySettings,
  listCapabilitySettings,
  updateCapabilitySettings,
  deleteCapabilitySettings,
} from '../services/capability-settings'

export const capabilitySettingsRouter = router({
  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    return getCapabilitySettings(input.id)
  }),

  list: protectedProcedure.query(async () => {
    return listCapabilitySettings()
  }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        provider: z.string(),
        apiKey: z.string().nullable().optional(),
        enabled: z.boolean().optional(),
        config: z.record(z.unknown()).nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await updateCapabilitySettings(input.id, {
          provider: input.provider,
          apiKey: input.apiKey ?? undefined,
          enabled: input.enabled,
          config: input.config ?? undefined,
        })
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to update capability',
        })
      }
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const deleted = await deleteCapabilitySettings(input.id)
    if (!deleted) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Capability setting "${input.id}" not found.`,
      })
    }
    return { ok: true }
  }),
})
