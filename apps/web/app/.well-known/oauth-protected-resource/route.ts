import { oAuthProtectedResourceMetadata } from 'better-auth/plugins'
import { getAuth } from '@/lib/auth'

export const GET = oAuthProtectedResourceMetadata(getAuth() as never)
