import { protectedProcedure, router } from '../trpc'
import {
  cancelRunByJob,
  getRunControlByJob,
  pauseRunByJob,
  resumeRunByJob,
} from '../services/runtime-control'
import { getRunTraceOp } from '../services/ops/traces'
import { getUtf8Chunk } from '../services/ops/chunking'
import {
  cancelRunInputSchema,
  pauseRunInputSchema,
  resumeRunInputSchema,
} from '../services/ops/schemas'
import { z } from 'zod'
import { findModelCallPayloadByHash } from '@nitejar/database'

export const jobsRouter = router({
  getJobWithMessages: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const trace = await getRunTraceOp({
        jobId: input.jobId,
        includeSpans: true,
        includeMessages: true,
        includeInferenceCalls: true,
        includeInferencePayloads: false,
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

  getInferencePayloadChunk: protectedProcedure
    .input(
      z.object({
        payloadHash: z.string().trim().min(1),
        chunkIndex: z.number().int().nonnegative().optional(),
        chunkSize: z.number().int().min(1).max(200_000).optional(),
      })
    )
    .query(async ({ input }) => {
      const payload = await findModelCallPayloadByHash(input.payloadHash)
      if (!payload) {
        throw new Error('Inference payload not found')
      }

      return {
        payloadHash: payload.hash,
        contentChunk: getUtf8Chunk(
          payload.payload_json,
          input.chunkIndex ?? 0,
          input.chunkSize ?? 100_000
        ),
        byteSize: payload.byte_size,
        createdAt: payload.created_at,
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
