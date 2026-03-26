import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { PageScrollShell } from '@/app/(app)/components/PageScrollShell'
import { RoutinesClient } from './RoutinesClient'

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
