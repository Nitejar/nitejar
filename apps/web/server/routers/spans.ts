import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'
import { getRunTraceOp } from '../services/ops/traces'

export const spansRouter = router({
  listByJob: protectedProcedure.input(z.object({ jobId: z.string() })).query(async ({ input }) => {
    const trace = await getRunTraceOp({ jobId: input.jobId, includeSpans: true })
    return trace.spans ?? []
  }),

  getJobSummary: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const trace = await getRunTraceOp({ jobId: input.jobId })
      return trace.summary
    }),
})
