import { z } from 'zod'
import { publicProcedure, router } from '../trpc'
import {
  emergencyStopRuntime,
  getRuntimeControlView,
  pauseRuntime,
  resumeRuntime,
} from '../services/runtime-control'
import { setMaxConcurrentDispatches } from '@nitejar/database'

export const runtimeControlRouter = router({
  get: publicProcedure.query(async () => {
    return getRuntimeControlView()
  }),

  pause: publicProcedure
    .input(
      z.object({
        actor: z.string().default('admin'),
        reason: z.string().optional(),
        mode: z.enum(['soft', 'hard']).optional(),
      })
    )
    .mutation(async ({ input }) => {
      return pauseRuntime({
        actor: input.actor,
        reason: input.reason,
        mode: input.mode,
      })
    }),

  resume: publicProcedure.mutation(async () => {
    return resumeRuntime()
  }),

  emergencyStop: publicProcedure
    .input(z.object({ actor: z.string().default('admin'), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      return emergencyStopRuntime({ actor: input.actor, reason: input.reason })
    }),

  setMaxConcurrentDispatches: publicProcedure
    .input(z.object({ value: z.number().int().min(1).max(100) }))
    .mutation(async ({ input }) => {
      const control = await setMaxConcurrentDispatches(input.value)
      return { maxConcurrentDispatches: control.max_concurrent_dispatches }
    }),

  stats: publicProcedure.query(async () => {
    const view = await getRuntimeControlView()
    return view.stats
  }),
})
