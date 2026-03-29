import loadable from 'next/dynamic'
import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '../components/PageHeader'
import { PageScrollShell } from '../components/PageScrollShell'
import { RouteClientFallback } from '../components/RouteClientFallback'

const PluginCatalogClient = loadable(
  () => import('./PluginCatalogClient').then((mod) => mod.PluginCatalogClient),
  {
    loading: () => <RouteClientFallback label="Loading plugins..." />,
  }
)

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Plugins')

export default function PluginsPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader title="Plugins" description="Connect platforms and services to your agents." />
      <PluginCatalogClient />
    </PageScrollShell>
  )
}
