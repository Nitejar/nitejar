import loadable from 'next/dynamic'
import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { PageScrollShell } from '@/app/(app)/components/PageScrollShell'
import { RouteClientFallback } from '@/app/(app)/components/RouteClientFallback'

const GatewaySettingsClient = loadable(
  () => import('./GatewaySettingsClient').then((mod) => mod.GatewaySettingsClient),
  {
    loading: () => <RouteClientFallback label="Loading gateway settings..." />,
  }
)

export const metadata = createPageMetadata('Gateway')

export default function GatewaySettingsPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        category="Settings"
        title="Gateway"
        description="Configure the shared OpenRouter gateway and refresh the model library."
      />
      <GatewaySettingsClient />
    </PageScrollShell>
  )
}
