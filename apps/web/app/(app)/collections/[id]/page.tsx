import { CollectionDetailClient } from './CollectionDetailClient'

export const dynamic = 'force-dynamic'

export default async function CollectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <CollectionDetailClient collectionId={id} />
}
