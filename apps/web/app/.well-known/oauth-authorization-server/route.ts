import { oAuthDiscoveryMetadata } from 'better-auth/plugins'
import { getAuth } from '@/lib/auth'

export const GET = oAuthDiscoveryMetadata(getAuth() as never)
