import { InstanceDetailClient } from './InstanceDetailClient'

export const dynamic = 'force-dynamic'

export default async function PluginInstanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <InstanceDetailClient pluginInstanceId={id} />
}
