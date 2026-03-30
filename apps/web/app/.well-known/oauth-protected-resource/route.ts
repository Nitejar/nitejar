import { oAuthProtectedResourceMetadata } from 'better-auth/plugins'
import { getAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const handler = oAuthProtectedResourceMetadata(getAuth() as never)
  return handler(request)
}
