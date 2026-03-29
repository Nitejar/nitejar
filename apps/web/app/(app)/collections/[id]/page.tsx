import type { Metadata } from 'next'
import loadable from 'next/dynamic'
import { findCollectionById } from '@nitejar/database'
import { createPageMetadata } from '@/app/metadata'
import { RouteClientFallback } from '@/app/(app)/components/RouteClientFallback'

const CollectionDetailClient = loadable(
  () => import('./CollectionDetailClient').then((mod) => mod.CollectionDetailClient),
  {
    loading: () => <RouteClientFallback label="Loading collection..." className="min-h-[420px]" />,
  }
)

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const collection = await findCollectionById(id)
  return createPageMetadata(collection?.name ?? 'Collection')
}

export default async function CollectionDetailPage({ params }: Props) {
  const { id } = await params
  return <CollectionDetailClient collectionId={id} />
}
