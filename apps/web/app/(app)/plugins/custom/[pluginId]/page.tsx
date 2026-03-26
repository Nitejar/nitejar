import type { Metadata } from 'next'
import { findPluginById } from '@nitejar/database'
import { createPageMetadata } from '@/app/metadata'
import { CustomPluginDetailClient } from './CustomPluginDetailClient'

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
