import { PageHeader } from '@/app/(app)/components/PageHeader'
import { RuntimeControlClient } from './RuntimeControlClient'

export default function RuntimeSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        category="Settings"
        title="Runtime"
        description="Pause processing globally, inspect queue health, and issue emergency stop operations."
      />
      <RuntimeControlClient />
    </div>
  )
}
