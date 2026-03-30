import { oAuthDiscoveryMetadata } from 'better-auth/plugins'
import { getAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export const GET = oAuthDiscoveryMetadata(getAuth() as never)
