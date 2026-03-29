import type { Metadata } from 'next'
import loadable from 'next/dynamic'
import { findTicketById } from '@nitejar/database'
import { createPageMetadata } from '@/app/metadata'
import { RouteClientFallback } from '@/app/(app)/components/RouteClientFallback'

const TicketDetailClient = loadable(
  () => import('./TicketDetailClient').then((mod) => mod.TicketDetailClient),
  {
    loading: () => <RouteClientFallback label="Loading ticket..." className="min-h-[480px]" />,
  }
)

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const ticket = await findTicketById(id)
  return createPageMetadata(ticket?.title ?? 'Ticket')
}

export default async function TicketDetailPage({ params }: Props) {
  const { id } = await params

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="space-y-4 p-6">
        <TicketDetailClient ticketId={id} />
      </div>
    </div>
  )
}
