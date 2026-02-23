'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { RelativeTime } from '@/app/(app)/components/RelativeTime'
import { SchemaFieldsTable } from '../components/SchemaFieldsTable'
import { SchemaDiff } from '../components/SchemaDiff'
import { IconCheckbox, IconChevronDown, IconChevronRight, IconLoader2 } from '@tabler/icons-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SchemaField = {
  name: string
  type: string
  required?: boolean
  description?: string | null
  enumValues?: string[]
}

type Review = {
  id: string
  collection_id: string | null
  collection_name: string
  action: 'create' | 'update'
  status: 'pending' | 'approved' | 'rejected'
  proposed_description: string | null
  proposed_schema: { fields: SchemaField[] }
  review_notes: string | null
  created_at: number
  reviewed_at: number | null
  requester: { id: string; name: string; handle: string }
  reviewer: { id: string; name: string; email: string | null } | null
}

type ConfirmAction = {
  reviewId: string
  decision: 'approve' | 'reject'
  collectionName: string
  action: 'create' | 'update'
}

// ---------------------------------------------------------------------------
// ReviewCard
// ---------------------------------------------------------------------------

function ReviewCard({
  review,
  onApprove,
  onReject,
  isPending,
}: {
  review: Review
  onApprove: (reviewId: string, notes: string) => void
  onReject: (reviewId: string, notes: string) => void
  isPending: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [notes, setNotes] = useState('')
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)

  // For update reviews, fetch the existing collection schema for diff
  const existingCollectionQuery = trpc.collections.getById.useQuery(
    { collectionId: review.collection_id! },
    { enabled: expanded && review.action === 'update' && review.collection_id !== null }
  )

  const fieldCount = review.proposed_schema.fields.length

  const proposalSummary =
    review.action === 'create'
      ? `@${review.requester.handle} wants to create a new collection "${review.collection_name}" with ${fieldCount} field${fieldCount !== 1 ? 's' : ''}.`
      : `@${review.requester.handle} wants to update "${review.collection_name}".`

  return (
    <>
      <div className="rounded-lg border border-white/10 bg-white/[0.02]">
        {/* Collapsed header */}
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 p-4 text-left"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-3 min-w-0">
            {expanded ? (
              <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
            )}

            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  'text-[11px] uppercase',
                  review.action === 'create'
                    ? 'border-blue-500/30 text-blue-400'
                    : 'border-violet-500/30 text-violet-400'
                )}
              >
                {review.action}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  'text-[11px]',
                  review.status === 'pending' && 'border-amber-500/30 text-amber-400',
                  review.status === 'approved' && 'border-emerald-500/30 text-emerald-400',
                  review.status === 'rejected' && 'border-red-500/30 text-red-400'
                )}
              >
                {review.status}
              </Badge>
            </div>

            <span className="font-mono text-sm text-foreground truncate">
              {review.collection_name}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-muted-foreground">
              @{review.requester.handle} &middot;{' '}
              <RelativeTime timestamp={review.reviewed_at ?? review.created_at} />
            </span>
            {review.status === 'pending' && !expanded && (
              <Badge variant="outline" className="border-amber-500/30 text-[11px] text-amber-400">
                Review
              </Badge>
            )}
          </div>
        </button>

        {/* Expanded content */}
        {expanded && (
          <div className="border-t border-white/10 p-4 space-y-5">
            {/* A. Proposal summary */}
            <p className="text-sm text-foreground">{proposalSummary}</p>

            {review.proposed_description && (
              <p className="text-xs text-muted-foreground">{review.proposed_description}</p>
            )}

            {/* B. Schema view */}
            <div className="space-y-3">
              <Label className="text-xs text-muted-foreground">Proposed Schema</Label>
              <SchemaFieldsTable fields={review.proposed_schema.fields} />
            </div>

            {/* C. Schema diff for update reviews */}
            {review.action === 'update' && review.collection_id && (
              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground">Changes from current schema</Label>
                {existingCollectionQuery.isLoading ? (
                  <div className="flex items-center gap-2 py-2">
                    <IconLoader2 className="size-3.5 animate-spin text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Loading current schema...</span>
                  </div>
                ) : existingCollectionQuery.data ? (
                  <SchemaDiff
                    currentFields={existingCollectionQuery.data.schema.fields}
                    proposedFields={review.proposed_schema.fields}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Could not load current schema for comparison.
                  </p>
                )}
              </div>
            )}

            {/* Reviewer notes (for completed reviews) */}
            {review.review_notes && review.status !== 'pending' && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Reviewer Notes</Label>
                <p className="text-xs text-foreground/80 rounded-md border border-white/10 bg-white/[0.02] p-2">
                  {review.review_notes}
                </p>
              </div>
            )}

            {/* D/E. Actions for pending reviews */}
            {review.status === 'pending' && (
              <div className="space-y-4 border-t border-white/10 pt-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Reviewer Notes (optional)</Label>
                  <Textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add notes about this decision..."
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    disabled={isPending}
                    onClick={() =>
                      setConfirmAction({
                        reviewId: review.id,
                        decision: 'reject',
                        collectionName: review.collection_name,
                        action: review.action,
                      })
                    }
                  >
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    disabled={isPending}
                    onClick={() =>
                      setConfirmAction({
                        reviewId: review.id,
                        decision: 'approve',
                        collectionName: review.collection_name,
                        action: review.action,
                      })
                    }
                  >
                    Approve
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* F. Confirmation dialog */}
      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.decision === 'approve' ? 'Approve' : 'Reject'} schema proposal?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.decision === 'approve'
                ? confirmAction.action === 'create'
                  ? `This will create the collection "${confirmAction.collectionName}" with the proposed schema. The requesting agent will gain access immediately.`
                  : `This will apply the proposed schema changes to "${confirmAction.collectionName}". Existing data will be preserved.`
                : `This will reject the schema proposal for "${confirmAction?.collectionName}". The requesting agent will be notified.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmAction?.decision === 'reject' ? 'destructive' : 'default'}
              disabled={isPending}
              onClick={() => {
                if (!confirmAction) return
                if (confirmAction.decision === 'approve') {
                  onApprove(confirmAction.reviewId, notes)
                } else {
                  onReject(confirmAction.reviewId, notes)
                }
                setConfirmAction(null)
              }}
            >
              {isPending
                ? 'Processing...'
                : confirmAction?.decision === 'approve'
                  ? 'Approve'
                  : 'Reject'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// ReviewsClient
// ---------------------------------------------------------------------------

export function ReviewsClient() {
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')

  const utils = trpc.useUtils()

  const reviewsQuery = trpc.collections.listSchemaReviews.useQuery(
    filter === 'pending' ? { status: 'pending', limit: 200 } : { limit: 200 }
  )

  const reviewMutation = trpc.collections.reviewSchemaRequest.useMutation({
    onSuccess: (data) => {
      if (data.status === 'approved' && data.collection) {
        const collectionId =
          typeof data.collection === 'object' && 'id' in data.collection
            ? (data.collection as { id: string }).id
            : null

        toast.success(
          <span>
            Collection created.{' '}
            {collectionId && (
              <Link
                href={`/collections/${collectionId}`}
                className="underline hover:text-foreground"
              >
                View collection
              </Link>
            )}
          </span>
        )
      } else if (data.status === 'rejected') {
        toast.success('Schema proposal rejected.')
      } else {
        toast.success('Schema review updated.')
      }

      void utils.collections.listSchemaReviews.invalidate()
      void utils.collections.listCollections.invalidate()
    },
    onError: (error) => toast.error(error.message),
  })

  const reviews = useMemo(() => reviewsQuery.data ?? [], [reviewsQuery.data])
  const pendingCount = useMemo(
    () => reviews.filter((r) => r.status === 'pending').length,
    [reviews]
  )

  const handleApprove = (reviewId: string, notes: string) => {
    reviewMutation.mutate({ reviewId, decision: 'approve', notes: notes || undefined })
  }

  const handleReject = (reviewId: string, notes: string) => {
    reviewMutation.mutate({ reviewId, decision: 'reject', notes: notes || undefined })
  }

  if (reviewsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <Tabs value={filter} onValueChange={(v) => setFilter(v as 'pending' | 'all')}>
        <TabsList variant="line">
          <TabsTrigger value="pending">
            Pending
            {pendingCount > 0 && (
              <Badge
                variant="outline"
                className="ml-1.5 border-amber-500/30 text-[10px] text-amber-400"
              >
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Review list */}
      {reviews.length === 0 ? (
        <Empty className="py-12">
          <EmptyMedia variant="icon">
            <IconCheckbox />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>All caught up</EmptyTitle>
            <EmptyDescription>
              {filter === 'pending'
                ? 'No schema proposals waiting for review.'
                : 'No schema reviews found.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review as Review}
              onApprove={handleApprove}
              onReject={handleReject}
              isPending={reviewMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}
