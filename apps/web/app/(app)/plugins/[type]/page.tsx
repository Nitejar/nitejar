import { PageHeader } from '../../components/PageHeader'
import { PluginTypeClient } from './PluginTypeClient'

export const dynamic = 'force-dynamic'

export default async function PluginTypePage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params

  return (
    <div className="space-y-6">
      <PageHeader title="" backLink={{ href: '/plugins', label: 'Back to Plugins' }} />
      <PluginTypeClient pluginType={type} />
    </div>
  )
}
