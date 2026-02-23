import { PageHeader } from '@/app/(app)/components/PageHeader'
import { GatewaySettingsClient } from './GatewaySettingsClient'

export default function GatewaySettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        category="Settings"
        title="Gateway"
        description="Configure the shared OpenRouter gateway and refresh the model library."
      />
      <GatewaySettingsClient />
    </div>
  )
}
