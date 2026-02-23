import { PageHeader } from '../components/PageHeader'
import { PluginCatalogClient } from './PluginCatalogClient'

export const dynamic = 'force-dynamic'

export default function PluginsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Plugins" description="Connect platforms and services to your agents." />
      <PluginCatalogClient />
    </div>
  )
}
