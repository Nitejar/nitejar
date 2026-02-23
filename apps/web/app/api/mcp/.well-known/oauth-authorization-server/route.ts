import { oAuthDiscoveryMetadata } from 'better-auth/plugins'
import { getAuth } from '@/lib/auth'

export function GET(request: Request): Promise<Response> {
  const handler = oAuthDiscoveryMetadata(getAuth() as never)
  return handler(request)
}
