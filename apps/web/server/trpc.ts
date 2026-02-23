import { TRPCError, initTRPC } from '@trpc/server'
import superjson from 'superjson'
import type { AuthSession } from '@/lib/auth'

export type TRPCContext = {
  session: AuthSession
}

export const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
})

export const router = t.router
export const publicProcedure = t.procedure

const requireSession = t.middleware(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  })
})

export const protectedProcedure = t.procedure.use(requireSession)
