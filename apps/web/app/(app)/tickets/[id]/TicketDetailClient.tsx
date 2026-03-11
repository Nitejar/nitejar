'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  IconArrowLeft,
  IconArrowRight,
  IconChevronRight,
  IconLink,
  IconMessageCircle,
  IconPlayerPlay,
  IconReceipt,
  IconSubtask,
  IconTarget,
} from '@tabler/icons-react'
import { Pencil } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { RelativeTime } from '@/app/(app)/components/RelativeTime'
import { SkeletonTicketDetail } from '@/app/(app)/work/skeletons'
import { toast } from 'sonner'
import {
  ALL_TICKET_STATUSES,
  AvatarCircle,
  InlineStatusPicker,
  StatusDot,
  type TicketStatus,
} from '@/app/(app)/work/shared'

// ---------------------------------------------------------------------------
// Inline editable title (matches TeamDetailClient pattern)
// ---------------------------------------------------------------------------

function EditableTicketTitle({
  title,
  onSave,
}: {
  title: string
  onSave: (newTitle: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [editing])

  useEffect(() => {
    setValue(title)
  }, [title])

  const commit = () => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== title) {
      onSave(trimmed)
    } else {
      setValue(title)
    }
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="group inline-flex items-center gap-2 text-left"
      >
        <h1 className="text-xl font-semibold tracking-tight text-white">{title}</h1>
        <Pencil className="h-3.5 w-3.5 text-white/15 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    )
  }

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          setValue(title)
          setEditing(false)
        }
      }}
      onBlur={commit}
      className="h-8 border-0 bg-transparent p-0 text-xl font-semibold tracking-tight text-white outline-none"
    />
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TicketDetailClient({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const [note, setNote] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState('')

  const ticketQuery = trpc.work.getTicket.useQuery({ ticketId })
  const agentsQuery = trpc.org.listAgents.useQuery()

  const updateTicketMutation = trpc.work.updateTicket.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.getTicket.invalidate({ ticketId }),
        utils.work.getDashboard.invalidate(),
        utils.work.listTickets.invalidate(),
      ])
    },
    onError: () => {
      toast.error('Failed to update ticket')
    },
  })
  const postUpdateMutation = trpc.work.postWorkUpdate.useMutation({
    onSuccess: async () => {
      setNote('')
      await utils.work.getTicket.invalidate({ ticketId })
    },
    onError: () => {
      toast.error('Failed to post update')
    },
  })
  const claimTicketMutation = trpc.work.claimTicket.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.getTicket.invalidate({ ticketId }),
        utils.work.listTickets.invalidate(),
      ])
    },
    onError: () => {
      toast.error('Failed to assign ticket')
    },
  })
  const startSessionMutation = trpc.sessions.startOrResume.useMutation({
    onSuccess: ({ sessionKey }) => {
      router.push(`/sessions/${encodeURIComponent(sessionKey)}`)
    },
    onError: () => {
      toast.error('Failed to start session')
    },
  })

  const ticket = ticketQuery.data

  useEffect(() => {
    if (!ticket) return
    if (ticket.assignee?.kind === 'agent') {
      setSelectedAgentId(ticket.assignee.ref)
    }
  }, [ticket])

  const agentOptions = useMemo(
    () =>
      (agentsQuery.data ?? []).map((agent) => ({
        id: agent.id,
        label: agent.name,
      })),
    [agentsQuery.data]
  )

  if (ticketQuery.isLoading || !ticket) {
    return <SkeletonTicketDetail />
  }

  const linkedSession = ticket.receiptSummary.links.find((link) => link.kind === 'session')

  return (
    <div className="space-y-6">
      {/* Hierarchy breadcrumb: Goal -> Parent -> Current */}
      {ticket.goal || ticket.parentTicket ? (
        <nav className="flex flex-wrap items-center gap-1.5 text-sm text-white/40">
          {ticket.goal ? (
            <>
              <Link
                href={`/goals/${ticket.goal.id}`}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 transition hover:bg-white/5 hover:text-white"
              >
                <IconTarget className="h-3.5 w-3.5" />
                {ticket.goal.title}
              </Link>
              <IconChevronRight className="h-3 w-3 text-white/20" />
            </>
          ) : null}
          {ticket.parentTicket ? (
            <>
              <Link
                href={`/tickets/${ticket.parentTicket.id}`}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 transition hover:bg-white/5 hover:text-white"
              >
                <IconArrowLeft className="h-3.5 w-3.5" />
                {ticket.parentTicket.title}
              </Link>
              <IconChevronRight className="h-3 w-3 text-white/20" />
            </>
          ) : null}
          <span className="px-2 py-1 text-white/70">{ticket.title}</span>
        </nav>
      ) : null}

      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <EditableTicketTitle
            title={ticket.title}
            onSave={(newTitle) =>
              updateTicketMutation.mutate({ ticketId, patch: { title: newTitle } })
            }
          />
          <InlineStatusPicker
            currentStatus={ticket.status}
            statuses={ALL_TICKET_STATUSES}
            onStatusChange={(s) =>
              updateTicketMutation.mutate({ ticketId, patch: { status: s as TicketStatus } })
            }
            showLabel
          />
          {ticket.isUnclaimed ? <Badge variant="outline">unclaimed</Badge> : null}
        </div>
        {ticket.body ? <p className="mt-2 max-w-3xl text-sm text-white/50">{ticket.body}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-white/35">
          <span className="flex items-center gap-1.5">
            Assignee:{' '}
            {ticket.assignee ? (
              <span className="inline-flex items-center gap-1">
                <AvatarCircle name={ticket.assignee.label} />
                {ticket.assignee.label}
              </span>
            ) : (
              'Unassigned'
            )}
          </span>
          <span>
            Updated <RelativeTime timestamp={ticket.updatedAt} />
          </span>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-8">
          {/* Updates */}
          <section>
            <div className="mb-3 flex items-center gap-2">
              <IconMessageCircle className="h-4 w-4 text-white/30" />
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">
                Updates
              </span>
              <span className="ml-auto text-[0.6rem] tabular-nums text-white/30">
                {ticket.updates.length}
              </span>
            </div>
            <div className="space-y-3">
              {ticket.updates.length > 0 ? (
                ticket.updates.map((update) => (
                  <div key={update.id} className="space-y-1 px-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{update.kind}</Badge>
                      <span className="text-[0.6rem] text-white/25">
                        <RelativeTime timestamp={update.created_at} />
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-white/50">{update.body}</p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-white/25">No updates yet.</p>
              )}
            </div>
          </section>

          {/* Linked Receipts */}
          <section>
            <div className="mb-3 flex items-center gap-2">
              <IconReceipt className="h-4 w-4 text-white/30" />
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">
                Linked Receipts
              </span>
              <span className="ml-auto text-[0.6rem] tabular-nums text-white/30">
                {ticket.receiptSummary.workItems.length}
              </span>
            </div>
            <div className="space-y-2">
              {linkedSession ? (
                <Link
                  href={`/sessions/${encodeURIComponent(linkedSession.ref)}`}
                  className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-3 transition hover:border-zinc-700 hover:bg-zinc-950/80"
                >
                  <div>
                    <p className="text-sm text-white/85">
                      {linkedSession.label || 'Linked session'}
                    </p>
                    <p className="mt-1 text-xs text-white/30">{linkedSession.ref}</p>
                  </div>
                  <IconArrowRight className="h-4 w-4 text-white/30" />
                </Link>
              ) : null}

              {ticket.receiptSummary.workItems.length > 0 ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 divide-y divide-zinc-800/60">
                  {ticket.receiptSummary.workItems.map((item) => (
                    <Link
                      key={item.id}
                      href={`/work-items/${item.id}`}
                      className="flex items-center justify-between px-4 py-2.5 transition hover:bg-white/[0.03]"
                    >
                      <div>
                        <p className="text-sm text-white/85">{item.title}</p>
                        <p className="mt-0.5 text-xs text-white/30">
                          {item.source} · {item.sessionKey}
                        </p>
                      </div>
                      <IconArrowRight className="h-4 w-4 text-white/30" />
                    </Link>
                  ))}
                </div>
              ) : !linkedSession ? (
                <p className="text-xs text-white/25">No execution receipts yet.</p>
              ) : null}
            </div>
          </section>

          {/* Sub-tickets */}
          {ticket.childTickets && ticket.childTickets.length > 0 ? (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <IconSubtask className="h-4 w-4 text-white/30" />
                <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">
                  Sub-tickets
                </span>
                <span className="ml-auto text-[0.6rem] tabular-nums text-white/30">
                  {ticket.childTickets.length}
                </span>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 divide-y divide-zinc-800/60">
                {ticket.childTickets.map((child) => (
                  <Link
                    key={child.id}
                    href={`/tickets/${child.id}`}
                    className="group flex items-center gap-2.5 px-4 py-2.5 transition hover:bg-white/[0.03]"
                  >
                    <StatusDot status={child.status} />
                    <span className="min-w-0 flex-1 truncate text-sm text-white/85">
                      {child.title}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {/* Related tickets */}
          {ticket.relatedTickets.length > 0 ? (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <IconLink className="h-4 w-4 text-white/30" />
                <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">
                  Related Open Tickets
                </span>
                <span className="ml-auto text-[0.6rem] tabular-nums text-white/30">
                  {ticket.relatedTickets.length}
                </span>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 divide-y divide-zinc-800/60">
                {ticket.relatedTickets.map((related) => (
                  <Link
                    key={related.id}
                    href={`/tickets/${related.id}`}
                    className="group flex items-center gap-2.5 px-4 py-2.5 transition hover:bg-white/[0.03]"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-white/85">
                      {related.title}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Properties */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-4">
            <div className="space-y-0.5">
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-white/40">Status</span>
                <span className="text-xs font-medium text-white/80 capitalize">
                  {ticket.status.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-white/40">Assignee</span>
                <span className="text-xs font-medium text-white/80">
                  {ticket.assignee ? ticket.assignee.label : 'Unassigned'}
                </span>
              </div>
              {ticket.goal ? (
                <div className="flex items-center justify-between py-1">
                  <span className="text-xs text-white/40">Goal</span>
                  <Link
                    href={`/goals/${ticket.goal.id}`}
                    className="text-xs text-white/80 hover:text-white transition-colors truncate max-w-[180px]"
                  >
                    {ticket.goal.title}
                  </Link>
                </div>
              ) : null}
              {ticket.parentTicket ? (
                <div className="flex items-center justify-between py-1">
                  <span className="text-xs text-white/40">Parent</span>
                  <Link
                    href={`/tickets/${ticket.parentTicket.id}`}
                    className="text-xs text-white/80 hover:text-white transition-colors truncate max-w-[180px]"
                  >
                    {ticket.parentTicket.title}
                  </Link>
                </div>
              ) : null}
              <div className="my-2 border-t border-zinc-800" />
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-white/40">Receipt cost</span>
                <span className="text-xs font-medium tabular-nums text-white/80">
                  ${ticket.receiptSummary.totalCostUsd.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-white/40">Work items</span>
                <span className="text-xs font-medium tabular-nums text-white/80">
                  {ticket.receiptSummary.workItems.length}
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-white/40">Activity entries</span>
                <span className="text-xs font-medium tabular-nums text-white/80">
                  {ticket.receiptSummary.activity.length}
                </span>
              </div>
            </div>
          </div>

          {/* Actions: Start Work + Post Update */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-4 space-y-4">
            {/* Start Work */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <IconPlayerPlay className="h-4 w-4 text-white/30" />
                <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">
                  Start Work
                </span>
              </div>
              <NativeSelect
                value={selectedAgentId}
                onChange={(event) => setSelectedAgentId(event.target.value)}
                className="w-full"
              >
                <NativeSelectOption value="">Select agent</NativeSelectOption>
                {agentOptions.map((agent) => (
                  <NativeSelectOption key={agent.id} value={agent.id}>
                    {agent.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                className="w-full"
                disabled={!selectedAgentId || startSessionMutation.isPending}
                onClick={async () => {
                  if (!selectedAgentId) return
                  if (
                    ticket.assignee?.kind !== 'agent' ||
                    ticket.assignee.ref !== selectedAgentId
                  ) {
                    await claimTicketMutation.mutateAsync({
                      ticketId,
                      assigneeKind: 'agent',
                      assigneeRef: selectedAgentId,
                    })
                  }
                  await startSessionMutation.mutateAsync({
                    agentId: selectedAgentId,
                    ticketId,
                  })
                }}
              >
                {linkedSession ? 'Resume linked session' : 'Start linked session'}
              </Button>
            </div>

            <div className="border-t border-zinc-800" />

            {/* Post Update */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <IconMessageCircle className="h-4 w-4 text-white/30" />
                <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">
                  Post Update
                </span>
              </div>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Leave a checkpoint or note on this ticket."
                rows={3}
              />
              <Button
                className="w-full"
                onClick={() => postUpdateMutation.mutate({ ticketId, body: note })}
                disabled={!note.trim() || postUpdateMutation.isPending}
              >
                Post Update
              </Button>
            </div>
          </div>

          {/* Activity */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-4 overflow-hidden">
            <div className="mb-3 flex items-center gap-2">
              <IconLink className="h-4 w-4 text-white/30" />
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">
                Activity
              </span>
            </div>
            {ticket.receiptSummary.activity.length > 0 ? (
              <div className="space-y-3">
                {ticket.receiptSummary.activity.map((entry) => (
                  <div key={entry.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{entry.status}</Badge>
                      <span className="text-[0.6rem] text-white/25">
                        <RelativeTime timestamp={entry.createdAt} />
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-white/50">{entry.summary}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/25">No activity recorded.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
