import { z } from 'zod'
import {
  listEffectOutboxByWorkItem,
  releaseUnknownEffectOutbox,
  retryFailedEffectOutbox,
  cancelEffectOutbox,
} from '@nitejar/database'
import { publicProcedure, router } from '../trpc'

export const outboxRouter = router({
  listByWorkItem: publicProcedure
    .input(z.object({ workItemId: z.string() }))
    .query(async ({ input }) => {
      return listEffectOutboxByWorkItem(input.workItemId)
    }),

  releaseUnknown: publicProcedure
    .input(z.object({ effectId: z.string(), actor: z.string().default('admin') }))
    .mutation(async ({ input }) => {
      const effect = await releaseUnknownEffectOutbox(input.effectId, input.actor)
      return { ok: !!effect, effect }
    }),

  retryFailed: publicProcedure
    .input(z.object({ effectId: z.string(), actor: z.string().default('admin') }))
    .mutation(async ({ input }) => {
      const effect = await retryFailedEffectOutbox(input.effectId, input.actor)
      return { ok: !!effect, effect }
    }),

  cancel: publicProcedure
    .input(z.object({ effectId: z.string(), reason: z.string().default('Cancelled by operator') }))
    .mutation(async ({ input }) => {
      const effect = await cancelEffectOutbox(input.effectId, input.reason)
      return { ok: !!effect, effect }
    }),
})
