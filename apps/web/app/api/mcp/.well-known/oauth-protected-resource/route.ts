import { oAuthProtectedResourceMetadata } from 'better-auth/plugins'
import { getAuth } from '@/lib/auth'

export function GET(request: Request): Promise<Response> {
  const handler = oAuthProtectedResourceMetadata(getAuth() as never)
  return handler(request)
}
