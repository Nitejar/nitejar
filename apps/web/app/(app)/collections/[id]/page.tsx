import type { Metadata } from 'next'
import { findCollectionById } from '@nitejar/database'
import { createPageMetadata } from '@/app/metadata'
import { CollectionDetailClient } from './CollectionDetailClient'

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
