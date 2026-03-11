import { SessionDetailClient } from './SessionDetailClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ sessionKey: string }>
}

export default async function SessionDetailPage({ params }: Props) {
  const { sessionKey } = await params
  const decodedSessionKey = decodeURIComponent(sessionKey)

  return <SessionDetailClient sessionKey={decodedSessionKey} />
}
