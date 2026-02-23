import { PageHeader } from '@/app/(app)/components/PageHeader'
import { RoutinesClient } from './RoutinesClient'

export default function RoutinesSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        category="Settings"
        title="Routines"
        description="Manage proactive routines, triggers, and run receipts."
      />
      <RoutinesClient />
    </div>
  )
}
