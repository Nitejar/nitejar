import { Suspense } from 'react'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { ClientErrorBoundary } from '@/app/(app)/components/ClientErrorBoundary'
import { OrganizationClient } from './OrganizationClient'

export default function OrganizationPage() {
  return (
    <div className="space-y-6">
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
    </div>
  )
}
