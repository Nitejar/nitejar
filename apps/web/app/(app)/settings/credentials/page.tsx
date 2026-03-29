import loadable from 'next/dynamic'
import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { PageScrollShell } from '@/app/(app)/components/PageScrollShell'
import { RouteClientFallback } from '@/app/(app)/components/RouteClientFallback'

const CredentialsClient = loadable(
  () => import('./CredentialsClient').then((mod) => mod.CredentialsClient),
  {
    loading: () => <RouteClientFallback label="Loading credentials..." />,
  }
)

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Credentials')

export default function CredentialsSettingsPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        category="Settings"
        title="Credentials"
        description="Manage agent-scoped API credentials for secure external HTTP requests."
      />
      <CredentialsClient />
    </PageScrollShell>
  )
}
