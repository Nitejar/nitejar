import { protectedProcedure, router } from '../trpc'
import {
  cancelRunByJob,
  getRunControlByJob,
  pauseRunByJob,
  resumeRunByJob,
} from '../services/runtime-control'
import { getRunTraceOp } from '../services/ops/traces'
import {
  cancelRunInputSchema,
  pauseRunInputSchema,
  resumeRunInputSchema,
} from '../services/ops/schemas'
import { z } from 'zod'

export const jobsRouter = router({
  getJobWithMessages: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const trace = await getRunTraceOp({
        jobId: input.jobId,
        includeSpans: true,
        includeMessages: true,
        includeInferenceCalls: true,
        includeBackgroundTasks: true,
      })
      const runControl = await getRunControlByJob(input.jobId)
      return {
        job: trace.run,
        messages: trace.messages ?? [],
        inferenceCalls: trace.inferenceCalls ?? [],
        backgroundTasks: trace.backgroundTasks ?? [],
        spans: trace.spans ?? [],
        runControl,
      }
    }),

  pauseRun: protectedProcedure.input(pauseRunInputSchema).mutation(async ({ input }) => {
    return pauseRunByJob({ jobId: input.jobId, actor: input.actor, reason: input.reason })
  }),

  resumeRun: protectedProcedure.input(resumeRunInputSchema).mutation(async ({ input }) => {
    return resumeRunByJob({ jobId: input.jobId })
  }),

  cancelRun: protectedProcedure.input(cancelRunInputSchema).mutation(async ({ input }) => {
    return cancelRunByJob({ jobId: input.jobId, actor: input.actor, reason: input.reason })
  }),
})
