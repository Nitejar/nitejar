import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../trpc'
import { getGatewaySettings, updateGatewaySettings } from '../services/gateway-settings'
import {
  ensureModelCatalogRefresh,
  listModelCatalog,
  refreshModelCatalog,
} from '../services/model-catalog'

const providerSchema = z.enum(['openrouter'])

export const gatewayRouter = router({
  getSettings: protectedProcedure.query(async () => {
    return getGatewaySettings()
  }),

  updateSettings: protectedProcedure
    .input(
      z.object({
        provider: providerSchema.optional(),
        baseUrl: z.string().nullable().optional(),
        apiKey: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await updateGatewaySettings({
          provider: input.provider,
          baseUrl: input.baseUrl ?? undefined,
          apiKey: input.apiKey ?? undefined,
        })
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to update settings',
        })
      }
    }),

  listModels: protectedProcedure.query(async () => {
    ensureModelCatalogRefresh()
    const { models, isStale } = await listModelCatalog()
    if (isStale) {
      refreshModelCatalog().catch((error) => {
        console.warn('[ModelCatalog] Refresh failed', error)
      })
    }

    return { models, refreshing: isStale }
  }),

  refreshModels: protectedProcedure.mutation(async () => {
    const result = await refreshModelCatalog()
    return {
      source: result.source,
      count: result.models.length,
      error: result.error ?? null,
    }
  }),
})
