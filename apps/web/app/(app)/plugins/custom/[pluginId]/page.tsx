import { CustomPluginDetailClient } from './CustomPluginDetailClient'

export const dynamic = 'force-dynamic'

export default async function CustomPluginDetailPage({
  params,
}: {
  params: Promise<{ pluginId: string }>
}) {
  const { pluginId } = await params
  return <CustomPluginDetailClient pluginId={pluginId} />
}
