import { PageHeader } from '../components/PageHeader'
import { ClientErrorBoundary } from '../components/ClientErrorBoundary'
import { CollectionsClient } from './CollectionsClient'

export default function CollectionsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        category="Organization"
        title="Collections"
        description="Shared structured data for agents. Review schema changes, edit schemas, and manage per-agent access."
      />

      <ClientErrorBoundary label="Collections">
        <CollectionsClient />
      </ClientErrorBoundary>
    </div>
  )
}
