import type { Metadata } from 'next'
import { findPluginInstanceById } from '@nitejar/database'
import { createPageMetadata } from '@/app/metadata'
import { InstanceDetailClient } from './InstanceDetailClient'

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
