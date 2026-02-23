import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { getAuth } from '@/lib/auth'
import { appRouter } from '@/server/routers/_app'
import type { TRPCContext } from '@/server/trpc'

const createContext = async (req: Request): Promise<TRPCContext> => {
  const session = await getAuth().api.getSession({ headers: req.headers })
  return { session }
}

const handler = async (req: Request) => {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createContext(req),
  })
}

export { handler as GET, handler as POST }
