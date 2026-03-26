import type { Metadata } from 'next'
import { findTicketById } from '@nitejar/database'
import { createPageMetadata } from '@/app/metadata'
import { TicketDetailClient } from './TicketDetailClient'

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
    <div className="space-y-4 p-6">
      <TicketDetailClient ticketId={id} />
    </div>
  )
}
