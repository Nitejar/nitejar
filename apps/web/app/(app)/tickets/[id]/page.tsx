import { PageHeader } from '@/app/(app)/components/PageHeader'
import { TicketDetailClient } from './TicketDetailClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function TicketDetailPage({ params }: Props) {
  const { id } = await params

  return (
    <div className="space-y-6">
      <PageHeader
        category="Tickets"
        title="Ticket"
        backLink={{ href: '/tickets', label: 'Tickets' }}
      />
      <TicketDetailClient ticketId={id} />
    </div>
  )
}
