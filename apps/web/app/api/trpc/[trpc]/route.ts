import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import type { TRPCContext } from '@/server/trpc'

const createContext = async (req: Request): Promise<TRPCContext> => {
  const { getAuth } = await import('@/lib/auth')
  const session = await getAuth().api.getSession({ headers: req.headers })
  return { session }
}

const handler = async (req: Request) => {
  const { appRouter } = await import('@/server/routers/_app')
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createContext(req),
  })
}

export { handler as GET, handler as POST }
