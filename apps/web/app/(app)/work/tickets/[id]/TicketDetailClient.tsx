'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { IconArrowRight, IconLink, IconPlayerPlay } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { RelativeTime } from '@/app/(app)/components/RelativeTime'

const TICKET_STATUSES = ['inbox', 'ready', 'in_progress', 'blocked', 'done', 'canceled'] as const
type TicketStatus = (typeof TICKET_STATUSES)[number]

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'blocked') return 'destructive'
  if (status === 'done' || status === 'canceled') return 'secondary'
  if (status === 'in_progress') return 'default'
  return 'outline'
}

function parseTicketStatus(value: string): TicketStatus {
  return TICKET_STATUSES.find((status) => status === value) ?? 'ready'
}

export function TicketDetailClient({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<TicketStatus>('ready')
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
  })
  const postUpdateMutation = trpc.work.postWorkUpdate.useMutation({
    onSuccess: async () => {
      setNote('')
      await utils.work.getTicket.invalidate({ ticketId })
    },
  })
  const claimTicketMutation = trpc.work.claimTicket.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.getTicket.invalidate({ ticketId }),
        utils.work.listTickets.invalidate(),
      ])
    },
  })
  const startSessionMutation = trpc.sessions.startOrResume.useMutation({
    onSuccess: ({ sessionKey }) => {
      router.push(`/sessions/${encodeURIComponent(sessionKey)}`)
    },
  })

  const ticket = ticketQuery.data

  useEffect(() => {
    if (!ticket) return
    setStatus(parseTicketStatus(ticket.status))
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
    return (
      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="py-10 text-sm text-muted-foreground">Loading ticket…</CardContent>
      </Card>
    )
  }

  const linkedSession = ticket.receiptSummary.links.find((link) => link.kind === 'session')

  return (
    <div className="space-y-6">
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-semibold">{ticket.title}</h3>
                <Badge variant={statusBadgeVariant(ticket.status)}>{ticket.status}</Badge>
                {ticket.isUnclaimed ? <Badge variant="outline">unclaimed</Badge> : null}
              </div>
              {ticket.body ? (
                <p className="max-w-3xl text-sm text-muted-foreground">{ticket.body}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {ticket.goal ? (
                  <Link href={`/work/goals/${ticket.goal.id}`} className="hover:text-white">
                    Goal: {ticket.goal.title}
                  </Link>
                ) : (
                  <span>No goal</span>
                )}
                <span>Assignee: {ticket.assignee ? ticket.assignee.label : 'Unassigned'}</span>
                <span>
                  Updated <RelativeTime timestamp={ticket.updatedAt} />
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                value={status}
                onChange={(event) => setStatus(parseTicketStatus(event.target.value))}
                className="w-full min-w-[180px]"
              >
                {TICKET_STATUSES.map((ticketStatus) => (
                  <NativeSelectOption key={ticketStatus} value={ticketStatus}>
                    {ticketStatus}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                variant="outline"
                onClick={() => updateTicketMutation.mutate({ ticketId, patch: { status } })}
                disabled={updateTicketMutation.isPending || status === ticket.status}
              >
                Update Status
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 md:grid-cols-3">
          <div className="bg-white/[0.03] p-4">
            <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">
              Receipt Cost
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              ${ticket.receiptSummary.totalCostUsd.toFixed(2)}
            </p>
          </div>
          <div className="bg-white/[0.03] p-4">
            <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">
              Work Items
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {ticket.receiptSummary.workItems.length}
            </p>
          </div>
          <div className="bg-white/[0.03] p-4">
            <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">
              Activity Entries
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {ticket.receiptSummary.activity.length}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Updates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {ticket.updates.length > 0 ? (
                ticket.updates.map((update) => (
                  <div
                    key={update.id}
                    className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Badge variant="outline">{update.kind}</Badge>
                      <span className="text-xs text-muted-foreground">
                        <RelativeTime timestamp={update.created_at} />
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{update.body}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No updates on this ticket yet.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Linked Receipts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {linkedSession ? (
                <Link
                  href={`/sessions/${encodeURIComponent(linkedSession.ref)}`}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] p-3 transition hover:border-white/20 hover:bg-white/[0.04]"
                >
                  <div>
                    <p className="text-sm font-medium">{linkedSession.label || 'Linked session'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{linkedSession.ref}</p>
                  </div>
                  <IconArrowRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ) : null}

              {ticket.receiptSummary.workItems.map((item) => (
                <Link
                  key={item.id}
                  href={`/work-items/${item.id}`}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] p-3 transition hover:border-white/20 hover:bg-white/[0.04]"
                >
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.source} · {item.sessionKey}
                    </p>
                  </div>
                  <IconArrowRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}

              {ticket.receiptSummary.links.length === 0 ? (
                <p className="text-sm text-muted-foreground">No receipts linked yet.</p>
              ) : null}
            </CardContent>
          </Card>

          {ticket.relatedTickets.length > 0 ? (
            <Card className="border-white/10 bg-white/[0.02]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Related Open Tickets</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {ticket.relatedTickets.map((related) => (
                  <Link
                    key={related.id}
                    href={`/work/tickets/${related.id}`}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 transition hover:bg-white/5"
                  >
                    <span className="truncate text-sm">{related.title}</span>
                    <IconArrowRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <IconPlayerPlay className="h-4 w-4" />
                Start Work
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
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
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Post Update</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Leave a checkpoint or note on this ticket."
                rows={5}
              />
              <Button
                className="w-full"
                onClick={() => postUpdateMutation.mutate({ ticketId, body: note })}
                disabled={!note.trim() || postUpdateMutation.isPending}
              >
                Post Update
              </Button>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <IconLink className="h-4 w-4" />
                Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {ticket.receiptSummary.activity.length > 0 ? (
                ticket.receiptSummary.activity.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-md border border-white/10 bg-white/[0.02] p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Badge variant="outline">{entry.status}</Badge>
                      <span className="text-xs text-muted-foreground">
                        <RelativeTime timestamp={entry.createdAt} />
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{entry.summary}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No receipt activity yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
