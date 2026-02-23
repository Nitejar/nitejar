import { PageHeader } from '@/app/(app)/components/PageHeader'
import { SessionDetailClient } from './SessionDetailClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ sessionKey: string }>
}

export default async function SessionDetailPage({ params }: Props) {
  const { sessionKey } = await params
  const decodedSessionKey = decodeURIComponent(sessionKey)

  return (
    <div className="space-y-6">
      <PageHeader
        category="Sessions"
        title="Session"
        backLink={{ href: '/sessions', label: 'Sessions' }}
      />
      <SessionDetailClient sessionKey={decodedSessionKey} />
    </div>
  )
}
