import type { Metadata } from 'next'
import loadable from 'next/dynamic'
import { createPageMetadata, formatSegmentTitle } from '@/app/metadata'
import { PageHeader } from '../../components/PageHeader'
import { PageScrollShell } from '../../components/PageScrollShell'
import { RouteClientFallback } from '../../components/RouteClientFallback'

const PluginTypeClient = loadable(
  () => import('./PluginTypeClient').then((mod) => mod.PluginTypeClient),
  {
    loading: () => <RouteClientFallback label="Loading plugin..." className="min-h-[360px]" />,
  }
)

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ type: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type } = await params
  return createPageMetadata(`${formatSegmentTitle(type)} Plugin`)
}

export default async function PluginTypePage({ params }: Props) {
  const { type } = await params

  return (
    <PageScrollShell className="space-y-6">
      <PageHeader title="" backLink={{ href: '/plugins', label: 'Back to Plugins' }} />
      <PluginTypeClient pluginType={type} />
    </PageScrollShell>
  )
}
