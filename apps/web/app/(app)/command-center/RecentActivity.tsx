'use client'

import Link from 'next/link'
import { parseAgentIdentityConfig } from '@/lib/agent-config-client'
import { RelativeTime } from '@/app/(app)/components/RelativeTime'
import { Skeleton } from '@/components/ui/skeleton'
import type { RouterOutputs } from '@/lib/trpc'

type ActivityEntry = RouterOutputs['commandCenter']['getRecentActivity'][number]

/** Strip common markdown syntax for plain-text display. */
function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '') // headings
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/__(.+?)__/g, '$1') // bold alt
    .replace(/\*(.+?)\*/g, '$1') // italic
    .replace(/_(.+?)_/g, '$1') // italic alt
    .replace(/`{1,3}[^`]*`{1,3}/g, '') // inline/block code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '') // images
    .replace(/^\|.*\|$/gm, '') // table rows
    .replace(/^\s*[-:|]+\s*$/gm, '') // table separators
    .replace(/^\s*[-*+]\s+/gm, '') // unordered list markers
    .replace(/^\s*\d+\.\s+/gm, '') // ordered list markers
    .replace(/\n{2,}/g, ' ') // collapse double newlines
    .replace(/\n/g, ' ') // remaining newlines
    .trim()
}

function AgentAvatar({ name, config }: { name: string | null; config: string | null }) {
  const displayName = name ?? 'Agent'
  const identity = parseAgentIdentityConfig(config)
  const initials = displayName
    .split(/[-_\s]/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-800 bg-gradient-to-br from-white/10 to-white/5">
      {identity.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={identity.avatarUrl} alt={displayName} className="h-full w-full object-cover" />
      ) : identity.emoji ? (
        <span className="text-[0.6rem] leading-none">{identity.emoji}</span>
      ) : (
        <span className="text-[0.45rem] font-semibold text-white/60">{initials}</span>
      )}
    </div>
  )
}

function StatusIndicator({ status }: { status: string }) {
  const color =
    status === 'completed' || status === 'passed'
      ? 'bg-emerald-500'
      : status === 'failed'
        ? 'bg-red-500'
        : 'bg-white/20'
  return <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
}

function entryHref(entry: ActivityEntry): string {
  if (entry.workItemId) return `/work-items/${entry.workItemId}`
  return `/agents/${entry.agentId}`
}

function ActivityRow({ entry, isLast }: { entry: ActivityEntry; isLast: boolean }) {
  const displayName = entry.agentName ?? entry.agentHandle
  const summary = stripMarkdown(entry.finalSummary || entry.summary)
  const durationLabel =
    entry.jobDurationSeconds != null
      ? entry.jobDurationSeconds >= 60
        ? `${Math.floor(entry.jobDurationSeconds / 60)}m ${entry.jobDurationSeconds % 60}s`
        : `${entry.jobDurationSeconds}s`
      : null

  return (
    <div className="-mx-1 flex gap-3 px-1 py-2.5">
      <div className="relative shrink-0">
        <Link href={`/agents/${entry.agentId}`}>
          <AgentAvatar name={entry.agentName} config={entry.agentConfig} />
        </Link>
        {!isLast && (
          <div className="absolute top-7 bottom-0 left-1/2 w-px -translate-x-1/2 bg-zinc-800/60" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <Link
            href={`/agents/${entry.agentId}`}
            className="truncate text-sm font-medium hover:underline"
          >
            {displayName}
          </Link>
          <RelativeTime
            timestamp={entry.createdAt}
            className="shrink-0 text-[0.6rem] text-muted-foreground"
          />
          {durationLabel && (
            <span className="shrink-0 text-[0.6rem] tabular-nums text-white/30">
              {durationLabel}
            </span>
          )}
          {entry.source && (
            <span className="shrink-0 rounded bg-white/[0.06] px-1 py-0.5 text-[0.5rem] text-muted-foreground">
              {entry.source}
            </span>
          )}
        </div>
        {entry.workItemTitle && (
          <Link
            href={entryHref(entry)}
            className="mt-0.5 block truncate text-xs text-white/50 hover:text-white/70 hover:underline"
          >
            {entry.workItemTitle}
          </Link>
        )}
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {summary}
        </p>
        {entry.goalTitle && entry.goalId && (
          <Link
            href={`/goals/${entry.goalId}`}
            className="mt-0.5 inline-block text-[0.6rem] text-white/30 transition hover:text-white/50 hover:underline"
          >
            {entry.goalTitle}
          </Link>
        )}
      </div>
      <StatusIndicator status={entry.status} />
    </div>
  )
}

function ActivitySkeleton() {
  return (
    <div className="space-y-4 py-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-[40%]" />
            <Skeleton className="h-2.5 w-[70%]" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function RecentActivity({
  entries,
  isLoading,
}: {
  entries: ActivityEntry[]
  isLoading: boolean
}) {
  return (
    <div className="min-w-0">
      <h2 className="mb-2 text-[0.65rem] font-medium uppercase tracking-[0.15em] text-muted-foreground">
        Recent activity
      </h2>
      {isLoading ? (
        <ActivitySkeleton />
      ) : entries.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">No recent activity</p>
      ) : (
        <div>
          {entries.map((entry, i) => (
            <ActivityRow key={entry.id} entry={entry} isLast={i === entries.length - 1} />
          ))}
        </div>
      )}
    </div>
  )
}
