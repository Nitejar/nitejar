import loadable from 'next/dynamic'
import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { PageScrollShell } from '@/app/(app)/components/PageScrollShell'
import { RouteClientFallback } from '@/app/(app)/components/RouteClientFallback'

const RoutinesClient = loadable(
  () => import('./RoutinesClient').then((mod) => mod.RoutinesClient),
  {
    loading: () => <RouteClientFallback label="Loading routines..." className="min-h-[420px]" />,
  }
)

export const metadata = createPageMetadata('Routines')

export default function RoutinesSettingsPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        category="Settings"
        title="Routines"
        description="Manage proactive routines, triggers, and run receipts."
      />
      <RoutinesClient />
    </PageScrollShell>
  )
}
