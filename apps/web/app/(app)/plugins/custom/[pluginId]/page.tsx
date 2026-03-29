import type { Metadata } from 'next'
import loadable from 'next/dynamic'
import { findPluginById } from '@nitejar/database'
import { createPageMetadata } from '@/app/metadata'
import { RouteClientFallback } from '@/app/(app)/components/RouteClientFallback'

const CustomPluginDetailClient = loadable(
  () => import('./CustomPluginDetailClient').then((mod) => mod.CustomPluginDetailClient),
  {
    loading: () => (
      <RouteClientFallback label="Loading custom plugin..." className="min-h-[420px]" />
    ),
  }
)

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ pluginId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { pluginId } = await params
  const plugin = await findPluginById(pluginId)
  return createPageMetadata(plugin?.name ?? 'Custom Plugin')
}

export default async function CustomPluginDetailPage({ params }: Props) {
  const { pluginId } = await params
  return <CustomPluginDetailClient pluginId={pluginId} />
}
