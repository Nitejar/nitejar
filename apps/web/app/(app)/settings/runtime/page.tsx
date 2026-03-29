import loadable from 'next/dynamic'
import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { PageScrollShell } from '@/app/(app)/components/PageScrollShell'
import { RouteClientFallback } from '@/app/(app)/components/RouteClientFallback'

const RuntimeControlClient = loadable(
  () => import('./RuntimeControlClient').then((mod) => mod.RuntimeControlClient),
  {
    loading: () => <RouteClientFallback label="Loading runtime controls..." />,
  }
)

export const metadata = createPageMetadata('Runtime')

export default function RuntimeSettingsPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        category="Settings"
        title="Runtime"
        description="Pause processing globally, inspect queue health, and issue emergency stop operations."
      />
      <RuntimeControlClient />
    </PageScrollShell>
  )
}
