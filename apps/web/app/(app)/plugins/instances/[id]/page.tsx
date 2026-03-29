import type { Metadata } from 'next'
import loadable from 'next/dynamic'
import { findPluginInstanceById } from '@nitejar/database'
import { createPageMetadata } from '@/app/metadata'
import { RouteClientFallback } from '@/app/(app)/components/RouteClientFallback'

const InstanceDetailClient = loadable(
  () => import('./InstanceDetailClient').then((mod) => mod.InstanceDetailClient),
  {
    loading: () => (
      <RouteClientFallback label="Loading plugin instance..." className="min-h-[420px]" />
    ),
  }
)

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const pluginInstance = await findPluginInstanceById(id)
  return createPageMetadata(pluginInstance?.name ?? 'Plugin Instance')
}

export default async function PluginInstanceDetailPage({ params }: Props) {
  const { id } = await params
  return <InstanceDetailClient pluginInstanceId={id} />
}
