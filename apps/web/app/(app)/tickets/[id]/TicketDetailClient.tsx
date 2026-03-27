'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Link2, Pencil, Play } from 'lucide-react'
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
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

type MentionTarget = {
  id: string
  kind: 'agent' | 'user'
  token: string
  label: string
  subtitle: string
}

function slugifyMentionToken(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'person'
  )
}

function getMentionTokenContext(text: string, cursorPos: number): { token: string; start: number } | null {
  const safePos = Math.max(0, Math.min(cursorPos, text.length))
  const before = text.slice(0, safePos)
  const tokenStart = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n')) + 1
  const token = before.slice(tokenStart)
  if (!token.startsWith('@')) return null
  return { token, start: tokenStart }
}

function parseMentionIds(
  text: string,
  targets: MentionTarget[]
): { agentIds: string[]; userIds: string[] } {
  const byToken = new Map(targets.map((target) => [target.token.toLowerCase(), target]))
  const mentionRegex = /@([a-z0-9_][a-z0-9_-]*)/gi
  const agentIds = new Set<string>()
  const userIds = new Set<string>()

  let match: RegExpExecArray | null
  while ((match = mentionRegex.exec(text)) !== null) {
    const target = byToken.get(match[1]!.toLowerCase())
    if (!target) continue
    if (target.kind === 'agent') agentIds.add(target.id)
    else userIds.add(target.id)
  }

  return {
    agentIds: [...agentIds],
    userIds: [...userIds],
  }
}

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
  const commentComposerRef = useRef<HTMLTextAreaElement | null>(null)
  const [note, setNote] = useState('')
  const [noteExpanded, setNoteExpanded] = useState(false)
  const [commentValue, setCommentValue] = useState('')
  const [commentKind, setCommentKind] = useState<
    'comment' | 'question' | 'decision_needed' | 'review_requested' | 'blocked'
  >('comment')
  const [commentMarkBlocked, setCommentMarkBlocked] = useState(false)
  const [commentCursor, setCommentCursor] = useState(0)
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
  const relatedSessionsQuery = trpc.sessions.listRelated.useQuery({
    ticketId,
    limit: 6,
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
  const postCommentMutation = trpc.work.postTicketComment.useMutation({
    onSuccess: async () => {
      setCommentValue('')
      setCommentKind('comment')
      setCommentMarkBlocked(false)
      await Promise.all([
        utils.work.getTicket.invalidate({ ticketId }),
        utils.work.getDashboard.invalidate(),
        utils.work.listTickets.invalidate(),
      ])
    },
    onError: () => {
      toast.error('Failed to post comment')
    },
  })
  const markInboxAttentionReadMutation = trpc.work.markInboxAttentionRead.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.getTicket.invalidate({ ticketId }),
        utils.work.getDashboard.invalidate(),
        utils.work.getInboxSummary.invalidate(),
        utils.work.listInboxAttention.invalidate(),
      ])
    },
    onError: () => {
      toast.error('Failed to update inbox state')
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
  const runTicketNowMutation = trpc.sessions.runTicketNow.useMutation({
    onSuccess: async ({ sessionKey }) => {
      await Promise.all([
        utils.work.getTicket.invalidate({ ticketId }),
        utils.work.listTickets.invalidate(),
      ])
      router.push(`/sessions/${encodeURIComponent(sessionKey)}`)
      toast.success('Execution queued')
    },
    onError: () => {
      toast.error('Failed to queue execution')
    },
  })

  const ticket = ticketQuery.data

  useEffect(() => {
    if (!ticket) return
    setAssigneeKind(ticket.assignee?.kind === 'user' ? 'user' : 'agent')
  }, [ticket])

  useEffect(() => {
    if (!ticket?.currentUserId) return
    if (markInboxAttentionReadMutation.isPending) return

    const hasUnreadForCurrentUser = ticket.attentionItems.some(
      (item) =>
        item.target_kind === 'user' &&
        item.target_ref === ticket.currentUserId &&
        item.read_at == null
    )

    if (!hasUnreadForCurrentUser) return

    markInboxAttentionReadMutation.mutate({
      ticketId,
      state: 'all',
      unreadOnly: true,
    })
  }, [markInboxAttentionReadMutation, ticket, ticketId])

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
  const mentionTargets = useMemo(() => {
    const used = new Set<string>()
    const targets: MentionTarget[] = []

    for (const agent of agentsQuery.data ?? []) {
      const token = agent.handle.toLowerCase()
      if (used.has(token)) continue
      used.add(token)
      targets.push({
        id: agent.id,
        kind: 'agent',
        token,
        label: agent.name,
        subtitle: `@${agent.handle}`,
      })
    }

    for (const member of membersQuery.data ?? []) {
      if (member.kind !== 'user') continue
      const baseToken = slugifyMentionToken(member.name || member.email.split('@')[0] || 'person')
      let token = baseToken
      let suffix = 2
      while (used.has(token)) {
        token = `${baseToken}-${suffix}`
        suffix += 1
      }
      used.add(token)
      targets.push({
        id: member.id,
        kind: 'user',
        token,
        label: member.name || member.email,
        subtitle: member.email,
      })
    }

    return targets
  }, [agentsQuery.data, membersQuery.data])
  const mentionContext = useMemo(() => {
    const context = getMentionTokenContext(commentValue, commentCursor)
    if (!context) return null
    const query = context.token.slice(1).toLowerCase()
    const matches = mentionTargets.filter((target) => target.token.startsWith(query)).slice(0, 8)
    return { ...context, matches }
  }, [commentCursor, commentValue, mentionTargets])

  const insertMention = (token: string) => {
    if (!mentionContext) return
    const nextValue = `${commentValue.slice(0, mentionContext.start)}@${token} ${commentValue.slice(commentCursor)}`
    setCommentValue(nextValue)
    const nextCursor = mentionContext.start + token.length + 2
    setCommentCursor(nextCursor)
    requestAnimationFrame(() => {
      commentComposerRef.current?.focus()
      commentComposerRef.current?.setSelectionRange(nextCursor, nextCursor)
    })
  }

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

  const linkedSession = relatedSessionsQuery.data?.items[0] ?? null
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
            <>
              <Button
                size="sm"
                className="h-7 gap-1.5 text-xs"
                disabled={runTicketNowMutation.isPending}
                onClick={async () => {
                  await runTicketNowMutation.mutateAsync({ ticketId })
                }}
              >
                <Play className="h-3.5 w-3.5" />
                Run now
              </Button>
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
                Start session
              </Button>
            </>
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
        {ticket.participants.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/45">
            <span className="uppercase tracking-[0.16em] text-white/30">Participants</span>
            {ticket.participants.slice(0, 6).map((participant) => (
              <span
                key={`${participant.kind}:${participant.ref}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800/80 bg-zinc-950/60 px-2 py-1 text-zinc-300"
              >
                <AvatarCircle name={participant.actor?.label ?? participant.ref} className="h-4 w-4 text-[8px]" />
                {participant.actor?.label ?? participant.ref}
              </span>
            ))}
          </div>
        ) : null}
        {ticket.attentionItems.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-amber-200/80">
            <span className="uppercase tracking-[0.16em] text-amber-300/60">Waiting on</span>
            {ticket.attentionItems.map((item) => (
              <span
                key={item.id}
                className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1"
              >
                {item.target?.label ?? item.target_ref}
              </span>
            ))}
          </div>
        ) : null}
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

      {/* Related sessions */}
      {linkedSession && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">Conversations</span>
          <Link
            href={`/sessions/${encodeURIComponent(linkedSession.sessionKey)}`}
            className="inline-flex items-center gap-2 text-zinc-300 transition hover:text-white"
          >
            {linkedSession.displayTitle}
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
          {relatedSessionsQuery.data && relatedSessionsQuery.data.items.length > 1 ? (
            <span className="text-xs text-zinc-500">+{relatedSessionsQuery.data.items.length - 1} more</span>
          ) : null}
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

      <section className="space-y-3 border-t border-zinc-800/60 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">Discussion</p>
            <p className="mt-1 text-sm text-zinc-500">
              Questions, approvals, and coordination live here. Keep receipts below.
            </p>
          </div>
          <div className="text-xs text-zinc-500">{ticket.comments.length} comments</div>
        </div>

        <div className="space-y-3">
          {ticket.comments.length > 0 ? (
            ticket.comments.map((comment) => (
              <div key={comment.id} className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{comment.kind}</Badge>
                  <span className="text-sm text-zinc-300">
                    {comment.author?.label ?? comment.author_ref ?? comment.author_kind}
                  </span>
                  <span className="text-[10px] text-zinc-600">
                    <RelativeTime timestamp={comment.created_at} />
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
                  {comment.body}
                </p>
                {comment.mentions.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                    <span className="uppercase tracking-[0.14em] text-zinc-600">Mentions</span>
                    {comment.mentions.map((mention) => (
                      <span
                        key={`${comment.id}:${mention.kind}:${mention.ref}`}
                        className="rounded-full border border-zinc-800 px-2 py-0.5 text-zinc-400"
                      >
                        {mention.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-sm text-zinc-500">
              No coordination thread yet. Use this section when someone needs an answer or approval.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              value={commentKind}
              onChange={(e) =>
                setCommentKind(
                  e.target.value as 'comment' | 'question' | 'decision_needed' | 'review_requested' | 'blocked'
                )
              }
              className="h-8 w-[180px] text-xs"
            >
              <NativeSelectOption value="comment">Comment</NativeSelectOption>
              <NativeSelectOption value="question">Question</NativeSelectOption>
              <NativeSelectOption value="decision_needed">Decision needed</NativeSelectOption>
              <NativeSelectOption value="review_requested">Review requested</NativeSelectOption>
              <NativeSelectOption value="blocked">Blocked</NativeSelectOption>
            </NativeSelect>
            <label className="inline-flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={commentMarkBlocked || commentKind === 'blocked'}
                onChange={(event) => setCommentMarkBlocked(event.target.checked)}
                disabled={commentKind === 'blocked'}
              />
              Mark ticket blocked
            </label>
          </div>
          <div className="mt-3">
            <Textarea
              ref={commentComposerRef}
              value={commentValue}
              onChange={(event) => setCommentValue(event.target.value)}
              onClick={(event) => setCommentCursor(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
              onKeyUp={(event) => setCommentCursor(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
              placeholder="Ask a question, request approval, or @mention the next person who needs to act…"
              rows={4}
              className="min-h-[100px] resize-y text-sm"
            />
            {mentionContext && mentionContext.matches.length > 0 ? (
              <div className="mt-2 rounded-md border border-zinc-800/80 bg-zinc-950/80 p-1">
                {mentionContext.matches.map((target) => (
                  <button
                    key={`${target.kind}:${target.id}`}
                    type="button"
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm text-zinc-300 transition hover:bg-white/[0.04]"
                    onClick={() => insertMention(target.token)}
                  >
                    <span>{target.label}</span>
                    <span className="text-xs text-zinc-500">@{target.token}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[11px] text-zinc-500">
              Agent handles keep their real `@handle`. People get local mention tokens for this composer.
            </p>
            <Button
              size="sm"
              disabled={!commentValue.trim() || postCommentMutation.isPending}
              onClick={() => {
                const mentions = parseMentionIds(commentValue, mentionTargets)
                postCommentMutation.mutate({
                  ticketId,
                  body: commentValue,
                  kind: commentKind,
                  mentionAgentIds: mentions.agentIds,
                  mentionUserIds: mentions.userIds,
                  markBlocked: commentKind === 'blocked' ? true : commentMarkBlocked,
                })
              }}
            >
              Post comment
            </Button>
          </div>
        </div>
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
                {relatedSessionsQuery.data?.items.map((session) => (
                  <Link
                    key={session.sessionKey}
                    href={`/sessions/${encodeURIComponent(session.sessionKey)}`}
                    className="flex items-center justify-between px-3 py-2 transition hover:bg-white/[0.03]"
                  >
                    <span className="text-sm text-zinc-300">{session.displayTitle}</span>
                  </Link>
                ))}
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
