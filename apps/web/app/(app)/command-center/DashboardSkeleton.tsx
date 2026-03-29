'use client'

import { Skeleton } from '@/components/ui/skeleton'

function PulseCellSkeleton() {
  return (
    <div className="px-4 py-2.5 space-y-2">
      <Skeleton className="h-2 w-16" />
      <Skeleton className="h-5 w-10" />
    </div>
  )
}

function TimelineEntrySkeleton() {
  return (
    <div className="flex gap-3 py-2.5">
      <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3 w-[45%]" />
        <Skeleton className="h-2.5 w-[65%]" />
      </div>
    </div>
  )
}

function FeedRowSkeleton() {
  return (
    <div className="flex items-center gap-2.5 px-2.5 py-2">
      <Skeleton className="h-1.5 w-1.5 shrink-0 rounded-full" />
      <Skeleton className="h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3 w-[55%]" />
        <Skeleton className="h-2 w-[40%]" />
      </div>
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Pulse strip */}
      <div className="grid grid-cols-2 divide-x divide-zinc-800/60 border-b border-zinc-800 sm:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={i === 4 ? 'hidden lg:block' : ''}>
            <PulseCellSkeleton />
          </div>
        ))}
      </div>

      {/* Main two-column area */}
      <div className="grid grid-cols-1 gap-6 px-4 lg:grid-cols-[minmax(0,1fr)_340px] sm:px-0">
        {/* Activity column */}
        <div className="space-y-0">
          <Skeleton className="mb-3 h-2.5 w-24" />
          {Array.from({ length: 5 }).map((_, i) => (
            <TimelineEntrySkeleton key={i} />
          ))}
        </div>
        {/* Attention column */}
        <div className="space-y-0">
          <Skeleton className="mb-3 h-2.5 w-28" />
          {Array.from({ length: 4 }).map((_, i) => (
            <FeedRowSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}
