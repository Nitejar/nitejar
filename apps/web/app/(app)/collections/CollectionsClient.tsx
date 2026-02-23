'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { RelativeTime } from '@/app/(app)/components/RelativeTime'
import { IconDatabase, IconAlertTriangle, IconSearch } from '@tabler/icons-react'

export function CollectionsClient() {
  const [search, setSearch] = useState('')

  const collectionsQuery = trpc.collections.listCollections.useQuery()
  const reviewsQuery = trpc.collections.listSchemaReviews.useQuery({
    status: 'pending',
    limit: 200,
  })

  const collections = useMemo(() => collectionsQuery.data ?? [], [collectionsQuery.data])
  const pendingReviewCount = useMemo(() => (reviewsQuery.data ?? []).length, [reviewsQuery.data])

  const filteredCollections = useMemo(() => {
    if (!search.trim()) return collections
    const query = search.toLowerCase()
    return collections.filter(
      (c) =>
        c.name.toLowerCase().includes(query) || (c.description ?? '').toLowerCase().includes(query)
    )
  }, [collections, search])

  // Find the first collection with pending reviews to deep-link into collection-specific reviews.
  const firstPendingCollectionId = useMemo(() => {
    if (!reviewsQuery.data?.length) return null
    const firstReview = reviewsQuery.data[0]
    if (!firstReview) return null
    const match = collections.find((c) => c.name === firstReview.collection_name)
    return match?.id ?? null
  }, [reviewsQuery.data, collections])

  const pendingReviewHref = firstPendingCollectionId
    ? `/collections/${firstPendingCollectionId}?tab=reviews`
    : '/collections/reviews'

  if (collectionsQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading collections...</p>
  }

  return (
    <div className="space-y-6">
      {/* Pending Reviews Banner */}
      {pendingReviewCount > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <IconAlertTriangle className="size-4 text-amber-400" />
            <span className="text-sm text-amber-200">
              {pendingReviewCount} schema change{pendingReviewCount !== 1 ? 's' : ''} waiting for
              review
            </span>
          </div>
          <Link href={pendingReviewHref}>
            <Button variant="outline" size="sm">
              Review &rarr;
            </Button>
          </Link>
        </div>
      )}

      {/* Collections Catalog Table */}
      {collections.length === 0 ? (
        <Empty className="py-12">
          <EmptyMedia variant="icon">
            <IconDatabase />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No collections yet</EmptyTitle>
            <EmptyDescription>
              Collections are agent-initiated structured datasets. An agent can propose one using
              the <code className="text-xs">define_collection</code> tool, then a human approves the
              schema before data flows in.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-4">
          {collections.length > 3 && (
            <div className="relative">
              <IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Filter collections..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 bg-white/[0.02] text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Fields</th>
                  <th className="px-3 py-2">Rows</th>
                  <th className="px-3 py-2">Agents</th>
                  <th className="px-3 py-2">Reviews</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filteredCollections.map((collection) => (
                  <tr key={collection.id} className="border-b border-white/5">
                    <td className="px-3 py-2">
                      <Link
                        href={`/collections/${collection.id}`}
                        className="block hover:underline"
                      >
                        <div className="font-medium text-foreground">{collection.name}</div>
                        {collection.description && (
                          <div className="max-w-xs truncate text-xs text-muted-foreground">
                            {collection.description}
                          </div>
                        )}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary" className="text-[11px]">
                        {collection.schema.fields.length}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {collection.rowCount}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {collection.permissions.length > 0 ? (
                        <Badge variant="outline" className="text-[11px]">
                          {collection.permissions.length}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground/50">Open</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {collection.pendingReviewCount > 0 ? (
                        <Badge
                          variant="outline"
                          className="border-amber-500/30 text-[11px] text-amber-400"
                        >
                          {collection.pendingReviewCount}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">&mdash;</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      <RelativeTime timestamp={collection.updated_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
