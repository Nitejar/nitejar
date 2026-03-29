'use client'

import Link from 'next/link'
import { StatusDot, AvatarCircle } from '@/app/(app)/work/shared'
import type { RouterOutputs } from '@/lib/trpc'

type WorkDashboard = RouterOutputs['work']['getDashboard']

const MAX_ITEMS = 6

export function CurrentWork({ work }: { work: WorkDashboard }) {
  const goals = work.atRiskGoals
    .filter((g) => g.status === 'active')
    .slice(0, 3)
    .map((g) => ({
      id: g.id,
      title: g.title,
      status: g.status,
      assignee: g.owner?.label ?? null,
      link: `/goals/${g.id}`,
    }))

  const tickets = work.activeTickets.slice(0, MAX_ITEMS - goals.length).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    assignee: t.assignee?.label ?? null,
    link: `/tickets/${t.id}`,
  }))

  const items = [...goals, ...tickets]
  if (items.length === 0) return null

  const hasMore =
    work.atRiskGoals.filter((g) => g.status === 'active').length + work.activeTickets.length >
    MAX_ITEMS

  return (
    <div className="border-t border-zinc-800 pt-4">
      <h2 className="mb-2 px-1 text-[0.65rem] font-medium uppercase tracking-[0.15em] text-muted-foreground">
        Work in flight
      </h2>
      <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.link}
            className="flex items-center gap-2 rounded px-2 py-1.5 transition hover:bg-white/[0.04]"
          >
            <StatusDot status={item.status} />
            <span className="min-w-0 flex-1 truncate text-xs">{item.title}</span>
            {item.assignee && (
              <AvatarCircle name={item.assignee} className="ml-auto h-4 w-4 shrink-0 text-[7px]" />
            )}
          </Link>
        ))}
      </div>
      {hasMore && (
        <Link
          href="/tickets"
          className="mt-1 inline-block px-2 text-[0.6rem] text-white/30 transition hover:text-white/50"
        >
          View all work &rarr;
        </Link>
      )}
    </div>
  )
}
