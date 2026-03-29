import loadable from 'next/dynamic'
import { createPageMetadata } from '@/app/metadata'
import { RouteClientFallback } from '../components/RouteClientFallback'

const TicketsClient = loadable(() => import('./TicketsClient').then((mod) => mod.TicketsClient), {
  loading: () => <RouteClientFallback label="Loading tickets..." className="min-h-[480px]" />,
})

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Tickets')

export default function TicketsPage() {
  return <TicketsClient />
}
