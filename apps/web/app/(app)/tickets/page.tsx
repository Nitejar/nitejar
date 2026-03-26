import { createPageMetadata } from '@/app/metadata'
import { TicketsClient } from './TicketsClient'

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Tickets')

export default function TicketsPage() {
  return <TicketsClient />
}
