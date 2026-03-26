import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '../components/PageHeader'
import { ClientErrorBoundary } from '../components/ClientErrorBoundary'
import { PageScrollShell } from '../components/PageScrollShell'
import { CollectionsClient } from './CollectionsClient'

export const metadata = createPageMetadata('Collections')

export default function CollectionsPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        category="Organization"
        title="Collections"
        description="Shared structured data for agents. Review schema changes, edit schemas, and manage per-agent access."
        action={{ href: '/collections/reviews', label: 'Schema Reviews' }}
      />

      <ClientErrorBoundary label="Collections">
        <CollectionsClient />
      </ClientErrorBoundary>
    </PageScrollShell>
  )
}
