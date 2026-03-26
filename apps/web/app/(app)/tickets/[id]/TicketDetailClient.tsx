'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Link2, Pencil } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'

import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'
import { RelativeTime } from '@/app/(app)/components/RelativeTime'
import { EditableDescription } from '@/app/(app)/components/EditableDescription'
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
// Inline editable title
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
// Recursive sub-ticket tree node type
// ---------------------------------------------------------------------------

type ChildTicketNode = {
  id: string
  title: string
  status: string
  assignee: { kind: string; ref: string; label: string; avatarUrl?: string | null } | null
  children: ChildTicketNode[]
}

function withCurrentOption(
  items: Array<{ value: string; label: string }>,
  current: { value: string; label: string } | null
) {
  if (!current || items.some((item) => item.value === current.value)) {
    return items
  }

  return [current, ...items]
}

// ---------------------------------------------------------------------------
// Recursive sub-ticket row
// ---------------------------------------------------------------------------

function SubTicketRow({
  node,
  depth,
  expanded,
  onToggle,
  onStatusChange,
}: {
  node: ChildTicketNode
  depth: number
  expanded: Set<string>
  onToggle: (id: string) => void
  onStatusChange: (ticketId: string, status: string) => void
}) {
  const hasChildren = node.children.length > 0
  const isOpen = expanded.has(node.id)

  return (
    <>
      <div
        className="flex items-center gap-1.5 py-1.5 transition hover:bg-white/[0.03]"
        style={{ paddingLeft: 12 + depth * 20 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <InlineStatusPicker
          currentStatus={node.status}
          statuses={ALL_TICKET_STATUSES}
          onStatusChange={(s) => onStatusChange(node.id, s)}
        />
        <Link
          href={`/tickets/${node.id}`}
          className="min-w-0 flex-1 truncate text-sm text-zinc-300 hover:text-white transition-colors"
        >
          {node.title}
        </Link>
        {node.assignee ? <AvatarCircle name={node.assignee.label} /> : null}
        {hasChildren && !isOpen ? (
          <span className="text-[10px] tabular-nums text-zinc-600 pr-2">
            {node.children.length}
          </span>
        ) : null}
      </div>
      {hasChildren && isOpen
        ? node.children.map((child) => (
            <SubTicketRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onStatusChange={onStatusChange}
            />
          ))
        : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TicketDetailClient({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const [note, setNote] = useState('')
  const [noteExpanded, setNoteExpanded] = useState(false)
  const [assigneeKind, setAssigneeKind] = useState<'user' | 'agent'>('agent')
  const [activityOpen, setActivityOpen] = useState(false)
  const [newSubTicketTitle, setNewSubTicketTitle] = useState('')
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [descriptionOpen, setDescriptionOpen] = useState(false)

  const ticketQuery = trpc.work.getTicket.useQuery({ ticketId })
  const agentsQuery = trpc.org.listAgents.useQuery()
  const membersQuery = trpc.org.listMembers.useQuery()
  const goalsQuery = trpc.work.listGoals.useQuery({
    limit: 200,
    includeArchived: false,
    sort: { field: 'title', direction: 'asc' },
  })
  const ticketsForParentQuery = trpc.work.listTickets.useQuery({
    scope: 'all',
    limit: 200,
    sort: { field: 'title', direction: 'asc' },
  })

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
      setNoteExpanded(false)
      await utils.work.getTicket.invalidate({ ticketId })
    },
    onError: () => {
      toast.error('Failed to post update')
    },
  })
  const createSubTicketMutation = trpc.work.createTicket.useMutation({
    onSuccess: async () => {
      setNewSubTicketTitle('')
      toast.success('Sub-ticket created')
      await Promise.all([
        utils.work.getTicket.invalidate({ ticketId }),
        utils.work.listTickets.invalidate(),
      ])
    },
    onError: () => {
      toast.error('Failed to create sub-ticket')
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
    setAssigneeKind(ticket.assignee?.kind === 'user' ? 'user' : 'agent')
  }, [ticket])

  const agentOptions = useMemo(
    () =>
      withCurrentOption(
        (agentsQuery.data ?? []).map((agent) => ({
          value: agent.id,
          label: agent.name,
        })),
        ticket?.assignee?.kind === 'agent'
          ? { value: ticket.assignee.ref, label: ticket.assignee.label }
          : null
      ),
    [agentsQuery.data, ticket?.assignee]
  )
  const memberOptions = useMemo(
    () =>
      withCurrentOption(
        (membersQuery.data ?? [])
          .filter((member) => member.kind === 'user')
          .map((member) => ({
            value: member.id,
            label: member.name || member.email,
          })),
        ticket?.assignee?.kind === 'user'
          ? { value: ticket.assignee.ref, label: ticket.assignee.label }
          : null
      ),
    [membersQuery.data, ticket?.assignee]
  )
  const goalItems = useMemo(
    () =>
      withCurrentOption(
        (goalsQuery.data ?? [])
          .filter((goal) => goal.id !== ticket?.goal?.id)
          .map((goal) => ({ value: goal.id, label: goal.title })),
        ticket?.goal ? { value: ticket.goal.id, label: ticket.goal.title } : null
      ),
    [goalsQuery.data, ticket?.goal]
  )
  const parentTicketItems = useMemo(
    () =>
      withCurrentOption(
        (ticketsForParentQuery.data ?? [])
          .filter((entry) => entry.id !== ticketId)
          .map((entry) => ({ value: entry.id, label: entry.title })),
        ticket?.parentTicket
          ? { value: ticket.parentTicket.id, label: ticket.parentTicket.title }
          : null
      ),
    [ticketsForParentQuery.data, ticketId, ticket?.parentTicket]
  )
  const assigneeOptions = assigneeKind === 'user' ? memberOptions : agentOptions

  if (ticketQuery.isLoading) {
    return <SkeletonTicketDetail />
  }

  if (ticketQuery.error) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 sm:p-8">
        <p className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">Ticket detail</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-white">
          We couldn&apos;t load this ticket.
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/55">
          {ticketQuery.error.message ||
            'The ticket detail view hit a snag before the data arrived.'}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link href="/tickets" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to tickets
          </Link>
          <Button size="sm" onClick={() => ticketQuery.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (!ticket) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 sm:p-8">
        <p className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">Ticket detail</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-white">Ticket not found.</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/55">
          This ticket may have been removed, merged into another thread, or the link is stale.
        </p>
        <div className="mt-5">
          <Link href="/tickets" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to tickets
          </Link>
        </div>
      </div>
    )
  }

  const linkedSession = ticket.receiptSummary.links.find((link) => link.kind === 'session')
  const hasActivity =
    ticket.updates.length > 0 ||
    ticket.receiptSummary.workItems.length > 0 ||
    ticket.receiptSummary.activity.length > 0
  const hasChildTickets = ticket.childTickets.length > 0
  const hasRelatedTickets = ticket.relatedTickets.length > 0
  const goalTicketsHref = ticket.goal ? `/tickets?goalId=${ticket.goal.id}` : '/tickets'
  const childrenAreComplete =
    ticket.childProgress.total > 0 && ticket.childProgress.done === ticket.childProgress.total
  const showCompletionNote =
    ticket.status === 'done' || ticket.status === 'canceled' || childrenAreComplete
  const activityCount =
    ticket.updates.length +
    ticket.receiptSummary.workItems.length +
    ticket.receiptSummary.activity.length
  const assignedAgentId = ticket.assignee?.kind === 'agent' ? ticket.assignee.ref : null

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <nav className="flex flex-wrap items-center gap-1.5 text-xs text-white/40">
        <Link
          href={goalTicketsHref}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition hover:bg-white/5 hover:text-white/75"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {ticket.goal ? 'Back to goal tickets' : 'Back to tickets'}
        </Link>
        {ticket.goal ? (
          <>
            <ChevronRight className="h-3 w-3" />
            <Link
              href={`/goals/${ticket.goal.id}`}
              className="rounded-md px-2 py-1 transition hover:bg-white/5 hover:text-white/75"
            >
              {ticket.goal.title}
            </Link>
          </>
        ) : null}
        {ticket.parentTicket ? (
          <>
            <ChevronRight className="h-3 w-3" />
            <Link
              href={`/tickets/${ticket.parentTicket.id}`}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition hover:bg-white/5 hover:text-white/75"
            >
              <StatusDot status={ticket.parentTicket.status} />
              {ticket.parentTicket.title}
            </Link>
          </>
        ) : null}
      </nav>

      {/* Title area */}
      <div className="space-y-2">
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
          {ticket.status !== 'done' && ticket.status !== 'canceled' && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={() =>
                updateTicketMutation.mutate(
                  { ticketId, patch: { status: 'done' as TicketStatus } },
                  { onSuccess: () => toast.success('Ticket marked done') }
                )
              }
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Mark done
            </Button>
          )}
          {assignedAgentId && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              disabled={startSessionMutation.isPending}
              onClick={async () => {
                await startSessionMutation.mutateAsync({
                  agentId: assignedAgentId,
                  ticketId,
                })
              }}
            >
              {linkedSession ? 'Resume session' : 'Start session'}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-zinc-400"
            onClick={() => {
              void navigator.clipboard.writeText(window.location.href)
              toast.success('Link copied')
            }}
          >
            <Link2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/35">
          <span className="inline-flex items-center gap-1.5">
            Assignee:{' '}
            {ticket.assignee ? (
              <span className="inline-flex items-center gap-1 text-zinc-300">
                <AvatarCircle name={ticket.assignee.label} />
                {ticket.assignee.label}
              </span>
            ) : (
              <span className="text-zinc-600">Unassigned</span>
            )}
          </span>
          {ticket.goal && !ticket.parentTicket ? (
            <span className="inline-flex items-center gap-1.5">
              Goal:{' '}
              <Link
                href={`/goals/${ticket.goal.id}`}
                className="text-zinc-300 hover:text-white transition-colors"
              >
                {ticket.goal.title}
              </Link>
            </span>
          ) : null}
          <span>
            Updated <RelativeTime timestamp={ticket.updatedAt} />
          </span>
        </div>
        {showCompletionNote && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100/85 motion-safe:animate-[fadeSlideIn_0.4s_ease-out]">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {ticket.status === 'canceled'
                ? 'This ticket is canceled, so new execution should happen elsewhere.'
                : 'This ticket looks wrapped. Use updates below for closeout notes, not for keeping the main thread understandable.'}
            </p>
          </div>
        )}
      </div>

      {/* Description */}
      <div>
        <button
          type="button"
          onClick={() => setDescriptionOpen(!descriptionOpen)}
          className="group flex w-full items-center gap-2 text-left"
        >
          <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
            Description
          </span>
          {!descriptionOpen && (
            <span className="min-w-0 flex-1 truncate text-sm text-white/50">
              {ticket.body || 'No description'}
            </span>
          )}
          <ChevronDown
            className={cn(
              'h-3 w-3 text-zinc-600 transition-transform ml-auto shrink-0',
              descriptionOpen && 'rotate-180'
            )}
          />
        </button>
        {descriptionOpen && (
          <div className="mt-2">
            <EditableDescription
              body={ticket.body}
              onSave={(body) =>
                updateTicketMutation.mutate({ ticketId, patch: { body: body || null } })
              }
            />
          </div>
        )}
      </div>

      {/* Sub-tickets */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
            Sub-tickets
            {hasChildTickets ? ` (${ticket.childProgress.done}/${ticket.childProgress.total})` : ''}
          </span>
        </div>
        {hasChildTickets ? (
          <div className="rounded-lg border border-zinc-800/40">
            {(ticket.childTickets as ChildTicketNode[]).map((child) => (
              <SubTicketRow
                key={child.id}
                node={child}
                depth={0}
                expanded={expandedNodes}
                onToggle={(id) =>
                  setExpandedNodes((prev) => {
                    const next = new Set(prev)
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                  })
                }
                onStatusChange={(childId, s) =>
                  updateTicketMutation.mutate({
                    ticketId: childId,
                    patch: { status: s as TicketStatus },
                  })
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-600">No sub-tickets yet.</p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const title = newSubTicketTitle.trim()
            if (!title) return
            createSubTicketMutation.mutate({
              title,
              parentTicketId: ticketId,
              goalId: ticket.goal?.id,
            })
          }}
          className="mt-2"
        >
          <input
            placeholder="Add sub-ticket..."
            value={newSubTicketTitle}
            onChange={(e) => setNewSubTicketTitle(e.target.value)}
            className="h-7 w-full border-0 bg-transparent text-sm text-zinc-300 placeholder:text-zinc-600 outline-none"
          />
        </form>
      </div>

      {/* Linked work */}
      {hasRelatedTickets && (
        <div>
          <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35 mb-2 block">
            Linked tickets ({ticket.relatedTickets.length})
          </span>
          <div className="rounded-lg border border-zinc-800/40">
            {ticket.relatedTickets.map((related) => (
              <Link
                key={related.id}
                href={`/tickets/${related.id}`}
                className="flex items-center gap-2.5 px-3 py-2 transition hover:bg-white/[0.03]"
              >
                <StatusDot status={related.status} />
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">
                  {related.title}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Linked session */}
      {linkedSession && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">
            Active thread
          </span>
          <Link
            href={`/sessions/${encodeURIComponent(linkedSession.ref)}`}
            className="inline-flex items-center gap-2 text-zinc-300 transition hover:text-white"
          >
            {linkedSession.label || 'Linked session'}
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* Properties */}
      <section className="space-y-3">
        <button
          type="button"
          onClick={() => setPropertiesOpen(!propertiesOpen)}
          className="group flex w-full items-center gap-2 text-left"
        >
          <p className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">Properties</p>
          <span className="text-xs text-zinc-500">
            {[
              ticket.assignee?.label,
              ticket.goal ? `\u2192 ${ticket.goal.title}` : null,
              ticket.parentTicket ? `\u2191 ${ticket.parentTicket.title}` : null,
            ]
              .filter(Boolean)
              .join(' \u00b7 ') || 'Not configured'}
          </span>
          <ChevronDown
            className={cn(
              'h-3 w-3 text-zinc-600 transition-transform ml-auto shrink-0',
              propertiesOpen && 'rotate-180'
            )}
          />
        </button>
        {propertiesOpen && (
          <div className="grid grid-cols-[100px_1fr] gap-y-3 text-sm">
            <span className="text-zinc-500 pt-1.5">Goal</span>
            <Combobox
              value={ticket.goal?.id ?? ''}
              onValueChange={(v) => {
                updateTicketMutation.mutate({ ticketId, patch: { goalId: v || null } })
              }}
            >
              <ComboboxInput
                placeholder="No goal"
                showClear={!!ticket.goal}
                className="h-8 w-full max-w-xs text-xs"
              />
              <ComboboxContent>
                <ComboboxList>
                  {goalItems.map((item) => (
                    <ComboboxItem key={item.value} value={item.value}>
                      {item.label}
                    </ComboboxItem>
                  ))}
                  <ComboboxEmpty>No goals found</ComboboxEmpty>
                </ComboboxList>
              </ComboboxContent>
            </Combobox>

            <span className="text-zinc-500 pt-1.5">Parent</span>
            <Combobox
              value={ticket.parentTicket?.id ?? ''}
              onValueChange={(v) => {
                updateTicketMutation.mutate({ ticketId, patch: { parentTicketId: v || null } })
              }}
            >
              <ComboboxInput
                placeholder="No parent ticket"
                showClear={!!ticket.parentTicket}
                className="h-8 w-full max-w-xs text-xs"
              />
              <ComboboxContent>
                <ComboboxList>
                  {parentTicketItems.map((item) => (
                    <ComboboxItem key={item.value} value={item.value}>
                      {item.label}
                    </ComboboxItem>
                  ))}
                  <ComboboxEmpty>No tickets found</ComboboxEmpty>
                </ComboboxList>
              </ComboboxContent>
            </Combobox>

            <span className="text-zinc-500 pt-1.5">Assignee</span>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-md border border-zinc-800 bg-zinc-950/60 p-0.5">
                <button
                  type="button"
                  onClick={() => setAssigneeKind('user')}
                  className={`rounded px-2 py-1 text-[10px] transition ${
                    assigneeKind === 'user'
                      ? 'bg-white/10 text-white'
                      : 'text-white/45 hover:text-white/75'
                  }`}
                >
                  People
                </button>
                <button
                  type="button"
                  onClick={() => setAssigneeKind('agent')}
                  className={`rounded px-2 py-1 text-[10px] transition ${
                    assigneeKind === 'agent'
                      ? 'bg-white/10 text-white'
                      : 'text-white/45 hover:text-white/75'
                  }`}
                >
                  Agents
                </button>
              </div>
              <Combobox
                value={ticket.assignee?.ref ?? ''}
                onValueChange={(v) => {
                  const ref = v || null
                  updateTicketMutation.mutate({
                    ticketId,
                    patch: {
                      assigneeKind: ref ? assigneeKind : null,
                      assigneeRef: ref,
                    },
                  })
                }}
              >
                <ComboboxInput
                  placeholder="Unassigned"
                  showClear={!!ticket.assignee}
                  className="h-8 flex-1 max-w-xs text-xs"
                />
                <ComboboxContent>
                  <ComboboxList>
                    {assigneeOptions.map((item) => (
                      <ComboboxItem key={item.value} value={item.value}>
                        {item.label}
                      </ComboboxItem>
                    ))}
                    <ComboboxEmpty>No results</ComboboxEmpty>
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>
          </div>
        )}
      </section>

      {/* Post update */}
      <div className="flex flex-wrap items-center gap-3">
        {noteExpanded ? (
          <div className="flex min-w-[280px] flex-1 items-start gap-2">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Leave a checkpoint or note..."
              rows={2}
              className="min-h-[40px] flex-1 resize-y text-sm"
            />
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() => postUpdateMutation.mutate({ ticketId, body: note })}
              disabled={!note.trim() || postUpdateMutation.isPending}
            >
              Post
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => {
                setNote('')
                setNoteExpanded(false)
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setNoteExpanded(true)}
            className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          >
            Post update
          </button>
        )}
      </div>

      <section className="border-t border-zinc-800/60 pt-4">
        {!hasActivity && !activityOpen ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Activity & Receipts
              </p>
              <p className="mt-1 text-sm leading-relaxed text-zinc-500">
                Nothing has landed yet. When work starts, updates, sessions, and work items will
                stack up here.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setActivityOpen(true)}>
              Open journal
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setActivityOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {activityOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Activity & Receipts
            <span className="ml-1 font-normal tabular-nums text-zinc-600">{activityCount}</span>
          </button>
        )}

        {activityOpen ? (
          <div className="mt-3 space-y-4">
            {ticket.updates.length > 0 ? (
              <div className="space-y-2">
                {ticket.updates.map((update) => (
                  <div key={update.id} className="space-y-1 px-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{update.kind}</Badge>
                      <span className="text-[10px] text-zinc-600">
                        <RelativeTime timestamp={update.created_at} />
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-zinc-400">{update.body}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {ticket.receiptSummary.workItems.length > 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 divide-y divide-zinc-800/60">
                {linkedSession ? (
                  <Link
                    href={`/sessions/${encodeURIComponent(linkedSession.ref)}`}
                    className="flex items-center justify-between px-3 py-2 transition hover:bg-white/[0.03]"
                  >
                    <span className="text-sm text-zinc-300">
                      {linkedSession.label || 'Linked session'}
                    </span>
                  </Link>
                ) : null}
                {ticket.receiptSummary.workItems.map((item) => (
                  <Link
                    key={item.id}
                    href={`/work-items/${item.id}`}
                    className="flex items-center justify-between px-3 py-2 transition hover:bg-white/[0.03]"
                  >
                    <div>
                      <p className="text-sm text-zinc-300">{item.title}</p>
                      <p className="mt-0.5 text-[10px] text-zinc-600">
                        {item.source} · {item.sessionKey}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : null}

            {ticket.receiptSummary.activity.length > 0 ? (
              <div className="space-y-2">
                {ticket.receiptSummary.activity.map((entry) => (
                  <div key={entry.id} className="space-y-1 px-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{entry.status}</Badge>
                      <span className="text-[10px] text-zinc-600">
                        <RelativeTime timestamp={entry.createdAt} />
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-zinc-400">{entry.summary}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {!hasActivity ? (
              <p className="text-sm leading-relaxed text-zinc-500">
                No receipts yet. When someone picks up the work, this panel turns into the boring
                proof.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}
