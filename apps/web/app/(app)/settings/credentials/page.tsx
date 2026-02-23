import { PageHeader } from '@/app/(app)/components/PageHeader'
import { CredentialsClient } from './CredentialsClient'

export const dynamic = 'force-dynamic'

export default function CredentialsSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        category="Settings"
        title="Credentials"
        description="Manage agent-scoped API credentials for secure external HTTP requests."
      />
      <CredentialsClient />
    </div>
  )
}
