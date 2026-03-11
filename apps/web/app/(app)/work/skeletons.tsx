/**
 * Shared skeleton loading primitives for Operate surfaces.
 * Uses animate-pulse with bg-white/[0.06] on dark backgrounds.
 */

import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function Bone({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-white/[0.06]', className)} />
}

// ---------------------------------------------------------------------------
// SkeletonRow — a single shimmer row (list / tree surfaces)
// ---------------------------------------------------------------------------

export function SkeletonRow({ indent = 0, className }: { indent?: number; className?: string }) {
  return (
    <div
      className={cn('flex items-center gap-3 border-b border-zinc-800/40 px-3 py-2.5', className)}
      style={{ paddingLeft: 12 + indent * 24 }}
    >
      <Bone className="h-4 w-4 shrink-0 rounded-full" />
      <Bone className="h-3 w-[40%]" />
      <div className="flex-1" />
      <Bone className="h-3 w-16" />
      <Bone className="h-3 w-10" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// SkeletonFeedRow — attention feed row shape (icon + two lines + timestamp)
// ---------------------------------------------------------------------------

export function SkeletonFeedRow({ className }: { className?: string } = {}) {
  return (
    <div className={cn('flex items-start gap-3 border-b border-zinc-800/40 px-4 py-3', className)}>
      <Bone className="mt-0.5 h-8 w-8 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <Bone className="h-3 w-[60%]" />
        <Bone className="h-2.5 w-[35%]" />
      </div>
      <Bone className="mt-1 h-2.5 w-12 shrink-0" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// SkeletonTable — shimmer rows matching table layout
// ---------------------------------------------------------------------------

export function SkeletonTable({
  rows = 5,
  columns = 5,
  className,
}: {
  rows?: number
  columns?: number
  className?: string
}) {
  return (
    <div className={cn('overflow-hidden border border-zinc-800', className)}>
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-zinc-800 px-4 py-2.5">
        {Array.from({ length: columns }).map((_, i) => (
          <Bone key={i} className={cn('h-2.5', i === 0 ? 'w-[30%]' : 'w-16')} />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-zinc-800/40 px-4 py-3">
          {i === 0 || i === 2 ? (
            <>
              <Bone className="h-9 w-9 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Bone className="h-3 w-[45%]" />
                <Bone className="h-2.5 w-[25%]" />
              </div>
            </>
          ) : (
            <Bone className="h-3 w-[40%]" />
          )}
          <div className="flex-1" />
          <Bone className="h-3 w-14" />
          <Bone className="h-3 w-10" />
          <Bone className="h-3 w-12" />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SkeletonDetailPanel — shimmer blocks for a properties panel
// ---------------------------------------------------------------------------

export function SkeletonDetailPanel({ className }: { className?: string } = {}) {
  return (
    <div className={cn('space-y-5 p-4', className)}>
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
        <Bone className="h-4 w-4 rounded" />
        <Bone className="h-4 w-[50%]" />
      </div>
      {/* Property rows */}
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="grid grid-cols-[100px_1fr] gap-y-2.5">
          <Bone className="h-3 w-16" />
          <Bone className="h-3 w-[60%]" />
        </div>
      ))}
      <Bone className="h-20 w-full rounded" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// SkeletonToolbar — shimmer matching standard toolbar
// ---------------------------------------------------------------------------

export function SkeletonToolbar({ className }: { className?: string } = {}) {
  return (
    <div className={cn('flex items-center gap-2 border-b border-zinc-800 px-4 py-1.5', className)}>
      <Bone className="h-4 w-20" />
      <div className="flex-1" />
      <Bone className="h-7 w-48 rounded-md" />
      <Bone className="h-7 w-16 rounded-md" />
      <Bone className="h-7 w-7 rounded-md" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// SkeletonSummaryCards — shimmer for summary card row (agents page)
// ---------------------------------------------------------------------------

export function SkeletonSummaryCards({
  count = 4,
  className,
}: {
  count?: number
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid divide-x divide-zinc-800 overflow-hidden border border-zinc-800',
        className
      )}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3 px-4 py-3">
          <Bone className="h-2 w-16" />
          <Bone className="h-6 w-12" />
          <Bone className="h-2 w-24" />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SkeletonTreeRows — hierarchy-suggesting shimmer rows
// ---------------------------------------------------------------------------

export function SkeletonTreeRows({
  className,
}: {
  className?: string
} = {}) {
  return (
    <div className={className}>
      <SkeletonRow />
      <SkeletonRow indent={1} />
      <SkeletonRow indent={1} />
      <SkeletonRow />
      <SkeletonRow indent={1} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// SkeletonCompanyTree — hierarchy with indentation suggesting org tree
// ---------------------------------------------------------------------------

export function SkeletonCompanyTree({ className }: { className?: string } = {}) {
  return (
    <div className={cn('space-y-1 p-4', className)}>
      {[0, 1, 1, 2, 0].map((indent, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded px-2 py-2"
          style={{ paddingLeft: 12 + indent * 20 }}
        >
          <Bone className="h-4 w-4 shrink-0 rounded" />
          <Bone className={cn('h-3', i % 2 === 0 ? 'w-[35%]' : 'w-[25%]')} />
          <div className="flex-1" />
          <Bone className="h-3 w-8" />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SkeletonGoalDetail — two-column goal detail layout
// ---------------------------------------------------------------------------

export function SkeletonGoalDetail({ className }: { className?: string } = {}) {
  return (
    <div className={cn('space-y-6', className)}>
      {/* Header card */}
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-6 space-y-3">
        <div className="flex items-center gap-3">
          <Bone className="h-5 w-[45%]" />
          <Bone className="h-5 w-14 rounded-full" />
        </div>
        <Bone className="h-3 w-[60%]" />
        <div className="flex items-center gap-3">
          <Bone className="h-2.5 w-20" />
          <Bone className="h-2.5 w-24" />
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {/* Tickets section */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <Bone className="h-3 w-16" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-white/10 p-3"
              >
                <Bone className="h-3 w-[50%]" />
                <div className="flex-1" />
                <Bone className="h-3 w-12" />
              </div>
            ))}
          </div>
          {/* Updates section */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <Bone className="h-3 w-16" />
            {Array.from({ length: 2 }).map((_, i) => (
              <Bone key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        </div>
        <div className="space-y-4">
          {/* Summary card */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <Bone className="h-3 w-16" />
                <Bone className="h-3 w-10" />
              </div>
            ))}
          </div>
          {/* Settings placeholder */}
          <Bone className="h-9 w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SkeletonTicketDetail — two-column ticket detail layout
// ---------------------------------------------------------------------------

export function SkeletonTicketDetail({ className }: { className?: string } = {}) {
  return (
    <div className={cn('space-y-6', className)}>
      {/* Header card */}
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-6 space-y-3">
        <div className="flex items-center gap-3">
          <Bone className="h-5 w-[40%]" />
          <Bone className="h-5 w-16 rounded-full" />
        </div>
        <Bone className="h-3 w-[55%]" />
        <div className="flex items-center gap-3">
          <Bone className="h-2.5 w-24" />
          <Bone className="h-2.5 w-20" />
        </div>
        {/* Receipt stats */}
        <div className="grid gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white/[0.03] p-4 space-y-2">
              <Bone className="h-2 w-16" />
              <Bone className="h-6 w-12" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {/* Updates */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <Bone className="h-3 w-16" />
            {Array.from({ length: 2 }).map((_, i) => (
              <Bone key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
          {/* Linked receipts */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <Bone className="h-3 w-24" />
            <Bone key="receipt" className="h-14 w-full rounded-lg" />
          </div>
        </div>
        <div className="space-y-6">
          {/* Start Work */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <Bone className="h-3 w-20" />
            <Bone className="h-9 w-full rounded-md" />
            <Bone className="h-9 w-full rounded-md" />
          </div>
          {/* Post Update */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <Bone className="h-3 w-20" />
            <Bone className="h-24 w-full rounded-md" />
          </div>
          {/* Activity */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <Bone className="h-3 w-16" />
            <Bone className="h-14 w-full rounded-lg" />
            <Bone className="h-14 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SkeletonTeamDetail — two-column team detail layout
// ---------------------------------------------------------------------------

export function SkeletonTeamDetail({ className }: { className?: string } = {}) {
  return (
    <div className={cn('space-y-6', className)}>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Bone className="h-2.5 w-14" />
        <Bone className="h-2.5 w-3" />
        <Bone className="h-2.5 w-20" />
      </div>
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Bone className="h-5 w-[30%]" />
          <Bone className="h-5 w-14 rounded-full" />
        </div>
        <Bone className="h-3 w-[50%]" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-8">
          {/* Members */}
          <div className="space-y-3">
            <Bone className="h-2.5 w-28" />
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 divide-y divide-zinc-800/60">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <Bone className="h-7 w-7 shrink-0 rounded-full" />
                  <Bone className="h-3 w-[40%]" />
                </div>
              ))}
            </div>
          </div>
          {/* Goals */}
          <div className="space-y-3">
            <Bone className="h-2.5 w-12" />
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 divide-y divide-zinc-800/60">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Bone className="h-2.5 w-2.5 rounded-full" />
                    <Bone className="h-3 w-[55%]" />
                  </div>
                  <Bone className="ml-5 h-1.5 w-full rounded-full" />
                </div>
              ))}
            </div>
          </div>
          {/* Tickets */}
          <div className="space-y-3">
            <Bone className="h-2.5 w-24" />
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 divide-y divide-zinc-800/60">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <Bone className="h-2 w-2 shrink-0 rounded-full" />
                  <Bone className="h-3 w-[50%]" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-6">
          {/* Portfolio stats */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-4 space-y-3">
            <Bone className="h-2.5 w-16" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <Bone className="h-2.5 w-20" />
                <Bone className="h-2.5 w-6" />
              </div>
            ))}
          </div>
          {/* Spend */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-4 space-y-3">
            <Bone className="h-2.5 w-12" />
            <div className="flex items-center justify-between">
              <Bone className="h-2.5 w-16" />
              <Bone className="h-2.5 w-10" />
            </div>
            <div className="flex items-center justify-between">
              <Bone className="h-2.5 w-16" />
              <Bone className="h-2.5 w-10" />
            </div>
          </div>
          {/* Activity */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-4 space-y-3">
            <Bone className="h-2.5 w-24" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Bone className="h-2 w-16" />
                <Bone className="h-3 w-[80%]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SkeletonSessionDetail — chat layout with message bubbles
// ---------------------------------------------------------------------------

export function SkeletonSessionDetail({ className }: { className?: string } = {}) {
  return (
    <div className={cn('space-y-4', className)}>
      <div className="rounded-lg border border-border/60 bg-card/70 p-4 space-y-4">
        {/* Header with avatars */}
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Bone key={i} className="h-8 w-8 rounded-full ring-2 ring-background" />
            ))}
          </div>
          <div className="space-y-1.5">
            <Bone className="h-3 w-32" />
            <Bone className="h-2.5 w-20" />
          </div>
        </div>
        {/* Linked ticket placeholder */}
        <Bone className="h-12 w-full rounded-lg" />
        {/* Chat timeline */}
        <div className="space-y-4 rounded-md border border-border/60 bg-background/20 p-4 min-h-[320px]">
          {/* User message (right) */}
          <div className="ml-auto max-w-[85%]">
            <Bone className="h-10 w-[70%] ml-auto rounded-lg" />
          </div>
          {/* Agent reply (left) */}
          <div className="max-w-[85%] space-y-1">
            <Bone className="h-2 w-20" />
            <Bone className="h-16 w-[80%] rounded-lg" />
          </div>
          {/* User message (right) */}
          <div className="ml-auto max-w-[85%]">
            <Bone className="h-8 w-[50%] ml-auto rounded-lg" />
          </div>
          {/* Agent reply (left) */}
          <div className="max-w-[85%] space-y-1">
            <Bone className="h-2 w-20" />
            <Bone className="h-24 w-[75%] rounded-lg" />
          </div>
        </div>
        {/* Composer */}
        <Bone className="h-[84px] w-full rounded-md" />
      </div>
    </div>
  )
}
