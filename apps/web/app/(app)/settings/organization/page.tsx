import { Suspense } from 'react'
import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { ClientErrorBoundary } from '@/app/(app)/components/ClientErrorBoundary'
import { PageScrollShell } from '@/app/(app)/components/PageScrollShell'
import { OrganizationClient } from './OrganizationClient'

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
        <Suspense fallback={null}>
          <OrganizationClient />
        </Suspense>
      </ClientErrorBoundary>
    </PageScrollShell>
  )
}
