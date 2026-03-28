'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { IconArrowRight, IconChecks, IconInbox, IconMessageCircle } from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { trpc } from '@/lib/trpc'
import { RelativeTime } from '@/app/(app)/components/RelativeTime'
import { cn } from '@/lib/utils'

type InboxState = 'all' | 'open' | 'resolved'

function stateLabel(state: InboxState) {
  switch (state) {
    case 'open':
      return 'Needs action'
    case 'resolved':
      return 'Resolved'
    default:
      return 'All'
  }
}

export function InboxClient() {
  const utils = trpc.useUtils()
  const [state, setState] = useState<InboxState>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const autoReadIdsRef = useRef<Set<string>>(new Set())

  const inboxQuery = trpc.work.listInboxAttention.useQuery(
    { state, unreadOnly, limit: 100, offset: 0 },
    { refetchInterval: 30_000 }
  )

  const markReadMutation = trpc.work.markInboxAttentionRead.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.listInboxAttention.invalidate(),
        utils.work.getInboxSummary.invalidate(),
        utils.work.getDashboard.invalidate(),
        utils.work.getTicket.invalidate(),
      ])
    },
  })

  const items = inboxQuery.data?.items ?? []
  const summary = inboxQuery.data?.summary ?? {
    totalCount: 0,
    openCount: 0,
    resolvedCount: 0,
    unreadCount: 0,
    unreadOpenCount: 0,
  }

  useEffect(() => {
    if (items.length === 0) {
      setSelectedId(null)
      return
    }

    if (!selectedId || !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0]!.id)
    }
  }, [items, selectedId])

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId]
  )

  useEffect(() => {
    if (!selectedItem?.isUnread) return
    if (autoReadIdsRef.current.has(selectedItem.id)) return
    autoReadIdsRef.current.add(selectedItem.id)
    markReadMutation.mutate({ ids: [selectedItem.id], state: 'all', unreadOnly: true })
  }, [markReadMutation, selectedItem])

  const visibleUnreadIds = useMemo(
    () => items.filter((item) => item.isUnread).map((item) => item.id),
    [items]
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label="Unread" value={summary.unreadCount} emphasis={summary.unreadCount > 0} />
        <SummaryTile
          label="Needs action"
          value={summary.openCount}
          emphasis={summary.openCount > 0}
        />
        <SummaryTile label="Resolved" value={summary.resolvedCount} />
        <SummaryTile label="Total log" value={summary.totalCount} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
        <Tabs value={state} onValueChange={(value) => setState(value as InboxState)}>
          <TabsList variant="line" className="gap-0">
            {(['all', 'open', 'resolved'] as const).map((value) => (
              <TabsTrigger key={value} value={value}>
                {stateLabel(value)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setUnreadOnly((current) => !current)}
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium transition',
              unreadOnly
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                : 'border-white/[0.08] bg-transparent text-white/55 hover:border-white/[0.14] hover:text-white/75'
            )}
          >
            Unread only
          </button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={visibleUnreadIds.length === 0 || markReadMutation.isPending}
            onClick={() =>
              markReadMutation.mutate({
                ids: visibleUnreadIds,
                state: 'all',
                unreadOnly: true,
              })
            }
          >
            <IconChecks className="h-3.5 w-3.5" />
            Mark visible read
          </Button>
        </div>
      </div>

      {inboxQuery.isLoading ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 text-sm text-white/45">
          Loading inbox…
        </div>
      ) : items.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-6 py-12 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03]">
            <IconInbox className="h-5 w-5 text-white/35" />
          </div>
          <p className="text-sm font-medium text-white/70">Nothing is waiting in your inbox.</p>
          <p className="mt-1 max-w-md text-sm text-white/45">
            Ticket mentions and approvals land here. If something needs a reply, it will still link
            back to the ticket that owns the conversation.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
            <div className="border-b border-white/[0.08] px-4 py-3 text-xs uppercase tracking-[0.2em] text-white/35">
              Notification log
            </div>
            <div className="divide-y divide-white/[0.06]">
              {items.map((item) => {
                const isSelected = item.id === selectedItem?.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={cn(
                      'flex w-full flex-col gap-2 px-4 py-3 text-left transition',
                      isSelected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium text-white/88">{item.title}</p>
                          {item.isUnread ? (
                            <Badge className="bg-amber-500/15 text-amber-300" variant="outline">
                              Unread
                            </Badge>
                          ) : (
                            <Badge className="text-white/45" variant="outline">
                              Read
                            </Badge>
                          )}
                          <Badge
                            className={cn(
                              item.status === 'open'
                                ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
                                : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                            )}
                            variant="outline"
                          >
                            {item.status === 'open' ? 'Needs action' : 'Resolved'}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-xs text-white/45">
                          {item.ticket?.title ?? 'Ticket context unavailable'}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-xs text-white/35">
                        <RelativeTime timestamp={item.createdAt} />
                      </div>
                    </div>
                    <p className="line-clamp-2 text-sm text-white/58">
                      {item.comment?.body || item.body || 'Open the ticket for the full thread.'}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-white/38">
                      {item.comment?.author ? (
                        <span>From {item.comment.author.label}</span>
                      ) : item.target ? (
                        <span>For {item.target.label}</span>
                      ) : null}
                      {item.goal ? <span>Goal: {item.goal.title}</span> : null}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02]">
            {selectedItem ? (
              <div className="space-y-5 p-5">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-white">{selectedItem.title}</h3>
                    {selectedItem.isUnread ? (
                      <Badge className="bg-amber-500/15 text-amber-300" variant="outline">
                        Unread
                      </Badge>
                    ) : null}
                    <Badge
                      className={cn(
                        selectedItem.status === 'open'
                          ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
                          : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                      )}
                      variant="outline"
                    >
                      {selectedItem.status === 'open' ? 'Needs action' : 'Resolved'}
                    </Badge>
                  </div>
                  <p className="text-sm text-white/55">
                    {selectedItem.body || 'This attention item points back to the ticket thread for context.'}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailField label="Ticket" value={selectedItem.ticket?.title ?? 'Unavailable'} />
                  <DetailField
                    label="Assignee"
                    value={selectedItem.ticket?.assignee?.label ?? 'Unassigned'}
                  />
                  <DetailField
                    label="Status"
                    value={(selectedItem.ticket?.status ?? 'unknown').replace(/_/g, ' ')}
                  />
                  <DetailField
                    label="Arrived"
                    value={new Date(selectedItem.createdAt * 1000).toLocaleString()}
                  />
                </div>

                {selectedItem.goal ? (
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white/65">
                    Goal: <span className="text-white/85">{selectedItem.goal.title}</span>
                  </div>
                ) : null}

                {selectedItem.comment ? (
                  <div className="space-y-2 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
                    <div className="flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                      <IconMessageCircle className="h-3.5 w-3.5" />
                      Latest relevant comment
                    </div>
                    <p className="text-sm text-white/75">{selectedItem.comment.body}</p>
                    <p className="text-xs text-white/40">
                      {selectedItem.comment.author?.label ?? 'Unknown author'} ·{' '}
                      <RelativeTime timestamp={selectedItem.comment.createdAt} />
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  {selectedItem.ticketId ? (
                    <Link
                      href={`/tickets/${selectedItem.ticketId}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition hover:border-primary/50 hover:bg-primary/15"
                    >
                      Open ticket
                      <IconArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  ) : null}
                  {selectedItem.goalId ? (
                    <Link
                      href={`/goals/${selectedItem.goalId}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] px-3 py-2 text-sm text-white/60 transition hover:border-white/[0.16] hover:text-white/85"
                    >
                      Open goal
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[420px] items-center justify-center p-6 text-sm text-white/45">
                Select a notification to see the ticket context.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryTile({
  label,
  value,
  emphasis = false,
}: {
  label: string
  value: number
  emphasis?: boolean
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
      <p className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">{label}</p>
      <p
        className={cn(
          'mt-2 text-2xl font-semibold tabular-nums text-white/88',
          emphasis && value > 0 && 'text-amber-200'
        )}
      >
        {value}
      </p>
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
      <p className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">{label}</p>
      <p className="mt-1 text-sm text-white/78">{value}</p>
    </div>
  )
}
