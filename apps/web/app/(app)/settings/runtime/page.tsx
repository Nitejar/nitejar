import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { PageScrollShell } from '@/app/(app)/components/PageScrollShell'
import { RuntimeControlClient } from './RuntimeControlClient'

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
