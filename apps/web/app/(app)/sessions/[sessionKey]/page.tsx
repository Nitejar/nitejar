import type { Metadata } from 'next'
import loadable from 'next/dynamic'
import { findAppSessionByKey } from '@nitejar/database'
import { createPageMetadata } from '@/app/metadata'
import { RouteClientFallback } from '@/app/(app)/components/RouteClientFallback'

const SessionDetailClient = loadable(
  () => import('./SessionDetailClient').then((mod) => mod.SessionDetailClient),
  {
    loading: () => <RouteClientFallback label="Loading session..." className="min-h-[420px]" />,
  }
)

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ sessionKey: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sessionKey } = await params
  const decodedSessionKey = decodeURIComponent(sessionKey)
  const session = await findAppSessionByKey(decodedSessionKey)
  return createPageMetadata(session?.title?.trim() || 'Session')
}

export default async function SessionDetailPage({ params }: Props) {
  const { sessionKey } = await params
  const decodedSessionKey = decodeURIComponent(sessionKey)

  return <SessionDetailClient sessionKey={decodedSessionKey} />
}
