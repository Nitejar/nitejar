import loadable from 'next/dynamic'
import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '../components/PageHeader'
import { PageScrollShell } from '../components/PageScrollShell'
import { RouteClientFallback } from '../components/RouteClientFallback'

const InboxClient = loadable(() => import('./InboxClient').then((mod) => mod.InboxClient), {
  loading: () => <RouteClientFallback label="Loading inbox..." />,
})

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Inbox')

export default function InboxPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        title="Inbox"
        description="Human-facing attention from ticket mentions, approvals, and delegated follow-ups. Tickets stay canonical; this is the log."
      />
      <InboxClient />
    </PageScrollShell>
  )
}
