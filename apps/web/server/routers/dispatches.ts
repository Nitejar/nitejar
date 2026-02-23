import { z } from 'zod'
import { listRunDispatchesByWorkItem, replayRunDispatch } from '@nitejar/database'
import { publicProcedure, router } from '../trpc'

export const dispatchesRouter = router({
  listByWorkItem: publicProcedure
    .input(z.object({ workItemId: z.string() }))
    .query(async ({ input }) => {
      return listRunDispatchesByWorkItem(input.workItemId)
    }),

  replay: publicProcedure
    .input(
      z.object({
        dispatchId: z.string(),
        actor: z.string().default('admin'),
        reason: z.string().default('Manual replay'),
        mode: z.enum(['restart', 'resume', 'retry']).default('restart'),
      })
    )
    .mutation(async ({ input }) => {
      const result = await replayRunDispatch(
        input.dispatchId,
        input.actor,
        input.reason,
        input.mode
      )
      if (!result) return { ok: false, replay: null, alreadyQueued: false }
      return { ok: true, replay: result.dispatch, alreadyQueued: result.alreadyQueued }
    }),
})
