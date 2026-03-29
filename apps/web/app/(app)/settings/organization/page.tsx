import loadable from 'next/dynamic'
import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { ClientErrorBoundary } from '@/app/(app)/components/ClientErrorBoundary'
import { PageScrollShell } from '@/app/(app)/components/PageScrollShell'
import { RouteClientFallback } from '@/app/(app)/components/RouteClientFallback'

const OrganizationClient = loadable(
  () => import('./OrganizationClient').then((mod) => mod.OrganizationClient),
  {
    loading: () => <RouteClientFallback label="Loading organization settings..." />,
  }
)

export const metadata = createPageMetadata('Organization')

export default function OrganizationPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        category="Settings"
        title="Organization"
        description="Manage teams, members, and access policies."
      />

      <ClientErrorBoundary label="Organization">
        <OrganizationClient />
      </ClientErrorBoundary>
    </PageScrollShell>
  )
}
