import { oAuthDiscoveryMetadata } from 'better-auth/plugins'
import { getAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const handler = oAuthDiscoveryMetadata(getAuth() as never)
  return handler(request)
}
