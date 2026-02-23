'use client'

import dynamic from 'next/dynamic'
import { trpc } from '@/lib/trpc'

const FleetDashboard = dynamic(
  () => import('./FleetDashboard').then((module) => module.FleetDashboard),
  { ssr: false }
)

type SessionItem = {
  sessionKey: string
  displayTitle: string
  lastMessageAt: number
  participants: Array<{
    id: string
    name: string
    emoji: string | null
    avatarUrl: string | null
  }>
}

export default function FleetPage() {
  const sessionsQuery = trpc.sessions.list.useQuery({ limit: 5 })

  const sessions: SessionItem[] = (sessionsQuery.data?.items ?? []).map((s) => ({
    sessionKey: s.sessionKey,
    displayTitle: s.displayTitle,
    lastMessageAt: s.lastMessageAt,
    participants: s.participants.map((p) => ({
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      avatarUrl: p.avatarUrl,
    })),
  }))

  return <FleetDashboard recentSessions={sessions} />
}
