'use client'

import React from 'react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowRight,
  Filter,
  Target,
  Ticket,
  Trash2,
  X,
} from 'lucide-react'
import { trpc, type RouterOutputs } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { RelativeTime } from '../components/RelativeTime'
import {
  type ActorKind,
  type TicketStatus,
  type TicketListInput,
  ALL_TICKET_STATUSES,
  OPEN_TICKET_STATUSES,
  DEFAULT_SORT,
  statusLabel,
  isTicketStatus,
  StatusDot,
  InlineStatusPicker,
  AvatarCircle,
  InlineCreateRow,
} from '../work/shared'
import { SkeletonTreeRows } from '../work/skeletons'
import {
  useTreeSelection,
  useTreeExpand,
  useTreeDragDrop,
  useTreeKeyboardNav,
  useTreeInlineEdit,
  applyOptimisticReorder,
} from '../work/tree-hooks'
import type { DropPosition } from '../work/tree-hooks'
import {
  TreeRootDropZone,
  TreeGroupEndDropZone,
  TreeToolbar,
  TreeBreadcrumb,
  TreeRow,
  TreeDetailLayout,
  InlineEditInput,
} from '../work/tree-components'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TicketRow = RouterOutputs['work']['listTickets'][number]

type TicketTreeNode = {
  ticket: TicketRow
  children: TicketTreeNode[]
}

type TicketView = {
  id: string
  name: string
  filters: TicketListInput
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TICKET_VIEWS: TicketView[] = [
  {
    id: 'active',
    name: 'Active',
    filters: {
      scope: 'all',
      statuses: ['in_progress', 'ready'],
      limit: 200,
      sort: DEFAULT_SORT,
    },
  },
  {
    id: 'all',
    name: 'All',
    filters: {
      scope: 'all',
      statuses: OPEN_TICKET_STATUSES,
      limit: 200,
      sort: DEFAULT_SORT,
    },
  },
  {
    id: 'blocked',
    name: 'Blocked',
    filters: {
      scope: 'all',
      statuses: ['blocked'],
      limit: 200,
      sort: DEFAULT_SORT,
    },
  },
  {
    id: 'inbox',
    name: 'Inbox',
    filters: {
      scope: 'all',
      statuses: ['inbox'],
      limit: 200,
      sort: DEFAULT_SORT,
    },
  },
  {
    id: 'unclaimed',
    name: 'Unclaimed',
    filters: {
      scope: 'unclaimed',
      statuses: OPEN_TICKET_STATUSES,
      limit: 200,
      sort: DEFAULT_SORT,
    },
  },
]

// ---------------------------------------------------------------------------
// Tree building
// ---------------------------------------------------------------------------

function buildTicketTree(tickets: TicketRow[]): TicketTreeNode[] {
  const ticketMap = new Map<string, TicketTreeNode>()
  for (const ticket of tickets) {
    ticketMap.set(ticket.id, { ticket, children: [] })
  }
  const roots: TicketTreeNode[] = []
  for (const ticket of tickets) {
    const node = ticketMap.get(ticket.id)!
    if (ticket.parentTicketId && ticketMap.has(ticket.parentTicketId)) {
      ticketMap.get(ticket.parentTicketId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  // Sort children by sort_order
  function sortChildren(nodes: TicketTreeNode[]) {
    nodes.sort((a, b) => a.ticket.sortOrder - b.ticket.sortOrder)
    for (const node of nodes) {
      sortChildren(node.children)
    }
  }
  sortChildren(roots)
  return roots
}

function flattenTicketTree(nodes: TicketTreeNode[]): TicketRow[] {
  const result: TicketRow[] = []
  for (const node of nodes) {
    result.push(node.ticket)
    result.push(...flattenTicketTree(node.children))
  }
  return result
}

function buildDescendantTicketMap(nodes: TicketTreeNode[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()

  function walk(node: TicketTreeNode): Set<string> {
    const descendants = new Set<string>()
    for (const child of node.children) {
      descendants.add(child.ticket.id)
      for (const grandchild of walk(child)) {
        descendants.add(grandchild)
      }
    }
    map.set(node.ticket.id, descendants)
    return descendants
  }

  for (const node of nodes) {
    walk(node)
  }

  return map
}

// ---------------------------------------------------------------------------
// TicketTreeRow — uses shared TreeRow for container, domain content as children
// ---------------------------------------------------------------------------

function TicketTreeRow({
  ticket,
  depth,
  isSelected,
  isExpanded,
  hasChildren,
  isDragging,
  isDragTarget,
  dropPosition,
  isEditing,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onToggle,
  onSelect,
  onStatusChange,
  onDelete,
  goalTitle,
  goalId,
  onAddChild,
  onDragStart,
  onDragEnd,
  dragHandlers,
}: {
  ticket: TicketRow
  depth: number
  isSelected: boolean
  isExpanded: boolean
  hasChildren: boolean
  isDragging: boolean
  isDragTarget?: boolean
  dropPosition?: DropPosition
  isEditing?: boolean
  onStartEdit?: () => void
  onCommitEdit?: (id: string, value: string) => void
  onCancelEdit?: () => void
  onToggle: () => void
  onSelect: () => void
  onStatusChange?: (status: string) => void
  onDelete?: () => void
  goalTitle?: string | null
  goalId?: string | null
  onAddChild?: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  dragHandlers?: {
    onDragOver?: React.DragEventHandler
    onDragEnter?: React.DragEventHandler
    onDragLeave?: React.DragEventHandler
    onDrop?: React.DragEventHandler
  }
}) {
  return (
    <TreeRow
      id={ticket.id}
      depth={depth}
      isSelected={isSelected}
      isExpanded={isExpanded}
      hasChildren={hasChildren}
      isDragging={isDragging}
      isDragTarget={isDragTarget}
      dropPosition={dropPosition}
      isEditing={isEditing}
      onToggle={onToggle}
      onSelect={onSelect}
      onDoubleClick={onStartEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      dragHandlers={dragHandlers}
      onAddChild={onAddChild}
    >
      {onStatusChange ? (
        <InlineStatusPicker
          currentStatus={ticket.status}
          statuses={ALL_TICKET_STATUSES}
          onStatusChange={onStatusChange}
        />
      ) : (
        <StatusDot status={ticket.status} />
      )}
      {isEditing && onCommitEdit && onCancelEdit ? (
        <InlineEditInput
          id={ticket.id}
          defaultValue={ticket.title}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{ticket.title}</span>
      )}
      {goalTitle && goalId && (
        <Link
          href={`/goals/${goalId}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex shrink-0 items-center gap-1 rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-500 transition hover:bg-white/[0.08] hover:text-zinc-300"
        >
          <Target className="h-2.5 w-2.5" />
          <span className="max-w-[100px] truncate">{goalTitle}</span>
        </Link>
      )}
      {ticket.childTicketCount > 0 && (
        <span className="shrink-0 text-[10px] text-zinc-600 tabular-nums">
          {ticket.childTicketCount} sub
        </span>
      )}
      {ticket.assignee ? <AvatarCircle name={ticket.assignee.label} /> : null}
      <span className="shrink-0 text-[11px] text-zinc-600 tabular-nums">
        <RelativeTime timestamp={ticket.updatedAt} />
      </span>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (window.confirm(`Cancel ticket "${ticket.title}"?`)) {
              onDelete()
            }
          }}
          className="inline-flex shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </TreeRow>
  )
}

// ---------------------------------------------------------------------------
// Recursive ticket tree rendering
// ---------------------------------------------------------------------------

function TicketTreeRows({
  nodes,
  depth,
  selectedTicketId,
  onSelect,
  onTicketStatusChange,
  onTicketDelete,
  onInlineSubTicketCreate,
  inlineSubTicketPending,
  showGoalTag,
  isExpanded,
  onToggle,
  draggedId,
  dragTargetId,
  dropPosition,
  startDrag,
  endDrag,
  getRowDragHandlers,
  getGroupEndDropHandlers,
  editingId,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  creatingChildOf,
  setCreatingChildOf,
}: {
  nodes: TicketTreeNode[]
  depth: number
  selectedTicketId: string | null
  onSelect: (id: string) => void
  onTicketStatusChange?: (ticketId: string, status: string) => void
  onTicketDelete?: (ticketId: string) => void
  onInlineSubTicketCreate?: (title: string, parentTicketId: string) => void
  inlineSubTicketPending?: boolean
  showGoalTag?: boolean
  isExpanded: (id: string) => boolean
  onToggle: (id: string) => void
  draggedId: string | null
  dragTargetId: string | null
  dropPosition: DropPosition
  startDrag: (id: string, event: React.DragEvent) => void
  endDrag: () => void
  getRowDragHandlers: (rowId: string) => {
    onDragOver?: React.DragEventHandler
    onDragEnter?: React.DragEventHandler
    onDragLeave?: React.DragEventHandler
    onDrop?: React.DragEventHandler
  } | undefined
  getGroupEndDropHandlers: (parentId: string) => {
    onDragOver?: React.DragEventHandler
    onDragEnter?: React.DragEventHandler
    onDragLeave?: React.DragEventHandler
    onDrop?: React.DragEventHandler
  } | undefined
  editingId: string | null
  onStartEdit: (id: string) => void
  onCommitEdit: (id: string, value: string) => void
  onCancelEdit: () => void
  creatingChildOf: string | null
  setCreatingChildOf: (id: string | null) => void
}) {
  return (
    <>
      {nodes.map((node) => {
        const ticket = node.ticket
        const hasChildren = node.children.length > 0
        const expanded = isExpanded(ticket.id)

        return (
          <React.Fragment key={ticket.id}>
            <TicketTreeRow
              ticket={ticket}
              depth={depth}
              isSelected={selectedTicketId === ticket.id}
              isExpanded={expanded}
              hasChildren={hasChildren}
              isDragging={draggedId === ticket.id}
              isDragTarget={dragTargetId === ticket.id}
              dropPosition={dragTargetId === ticket.id ? dropPosition : null}
              isEditing={editingId === ticket.id}
              onStartEdit={() => onStartEdit(ticket.id)}
              onCommitEdit={onCommitEdit}
              onCancelEdit={onCancelEdit}
              onToggle={() => onToggle(ticket.id)}
              onSelect={() => onSelect(ticket.id)}
              onStatusChange={
                onTicketStatusChange ? (s) => onTicketStatusChange(ticket.id, s) : undefined
              }
              onDelete={onTicketDelete ? () => onTicketDelete(ticket.id) : undefined}
              goalTitle={showGoalTag ? ticket.goal?.title : undefined}
              goalId={showGoalTag ? ticket.goal?.id : undefined}
              onAddChild={onInlineSubTicketCreate ? () => setCreatingChildOf(ticket.id) : undefined}
              onDragStart={(e) => startDrag(ticket.id, e)}
              onDragEnd={endDrag}
              dragHandlers={getRowDragHandlers(ticket.id)}
            />
            {creatingChildOf === ticket.id && onInlineSubTicketCreate && (
              <InlineCreateRow
                placeholder="New sub-ticket..."
                depth={depth + 1}
                isPending={!!inlineSubTicketPending}
                autoFocus
                onSubmit={(title) => {
                  onInlineSubTicketCreate(title, ticket.id)
                  setCreatingChildOf(null)
                }}
                onCancel={() => setCreatingChildOf(null)}
              />
            )}
            {expanded && hasChildren && (
              <>
                <TicketTreeRows
                  nodes={node.children}
                  depth={depth + 1}
                  selectedTicketId={selectedTicketId}
                  onSelect={onSelect}
                  onTicketStatusChange={onTicketStatusChange}
                  onTicketDelete={onTicketDelete}
                  onInlineSubTicketCreate={onInlineSubTicketCreate}
                  inlineSubTicketPending={inlineSubTicketPending}
                  showGoalTag={showGoalTag}
                  isExpanded={isExpanded}
                  onToggle={onToggle}
                  draggedId={draggedId}
                  dragTargetId={dragTargetId}
                  dropPosition={dropPosition}
                  startDrag={startDrag}
                  endDrag={endDrag}
                  getRowDragHandlers={getRowDragHandlers}
                  getGroupEndDropHandlers={getGroupEndDropHandlers}
                  editingId={editingId}
                  onStartEdit={onStartEdit}
                  onCommitEdit={onCommitEdit}
                  onCancelEdit={onCancelEdit}
                  creatingChildOf={creatingChildOf}
                  setCreatingChildOf={setCreatingChildOf}
                />
                <TreeGroupEndDropZone
                  active={!!draggedId}
                  depth={depth}
                  handlers={getGroupEndDropHandlers(ticket.id)}
                />
              </>
            )}
          </React.Fragment>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// Ticket detail panel
// ---------------------------------------------------------------------------

function TicketDetailPanel({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const [selectedAgentId, setSelectedAgentId] = useState('')

  const ticketQuery = trpc.work.getTicket.useQuery({ ticketId })
  const agentsQuery = trpc.org.listAgents.useQuery()
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
  const updateTicketDetailMutation = trpc.work.updateTicket.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.getTicket.invalidate({ ticketId }),
        utils.work.listTickets.invalidate(),
        utils.work.listGoals.invalidate(),
      ])
    },
    onError: () => {
      toast.error('Failed to update ticket')
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
    () => (agentsQuery.data ?? []).map((a) => ({ id: a.id, label: a.name })),
    [agentsQuery.data]
  )
  const goalItems = useMemo(
    () =>
      (goalsQuery.data ?? [])
        .filter((goal) => goal.id !== ticket?.goal?.id)
        .map((goal) => ({ value: goal.id, label: goal.title })),
    [goalsQuery.data, ticket?.goal?.id]
  )

  const parentTicketItems = useMemo(
    () =>
      (ticketsForParentQuery.data ?? [])
        .filter((t) => t.id !== ticketId)
        .map((t) => ({ value: t.id, label: t.title })),
    [ticketsForParentQuery.data, ticketId]
  )

  if (ticketQuery.isLoading || !ticket) {
    return <div className="p-6 text-sm text-zinc-500">Loading ticket...</div>
  }

  const linkedSession = ticket.receiptSummary.links.find((l) => l.kind === 'session')

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800 px-4 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-zinc-100">{ticket.title}</h2>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-5 p-4">
          {/* Properties */}
          <div className="grid grid-cols-[100px_1fr] gap-y-2.5 text-sm">
            <span className="text-zinc-500">Status</span>
            <InlineStatusPicker
              currentStatus={ticket.status}
              statuses={ALL_TICKET_STATUSES}
              showLabel
              onStatusChange={(s) => {
                updateTicketDetailMutation.mutate({
                  ticketId,
                  patch: { status: s as TicketStatus },
                })
              }}
            />

            <span className="text-zinc-500">Assignee</span>
            <span className="text-zinc-300">
              {ticket.assignee ? ticket.assignee.label : 'Unassigned'}
            </span>

            <span className="text-zinc-500">Goal</span>
            <Combobox
              value={ticket.goal?.id ?? ''}
              onValueChange={(value) =>
                updateTicketDetailMutation.mutate({
                  ticketId,
                  patch: { goalId: value || null },
                })
              }
            >
              <ComboboxInput
                placeholder="No goal"
                showClear={!!ticket.goal}
                className="h-7 text-xs"
              />
              <ComboboxContent>
                <ComboboxList>
                  {ticket.goal ? (
                    <ComboboxItem value={ticket.goal.id}>{ticket.goal.title}</ComboboxItem>
                  ) : null}
                  {goalItems.map((item) => (
                    <ComboboxItem key={item.value} value={item.value}>
                      {item.label}
                    </ComboboxItem>
                  ))}
                  <ComboboxEmpty>No goals found</ComboboxEmpty>
                </ComboboxList>
              </ComboboxContent>
            </Combobox>

            <span className="text-zinc-500">Parent ticket</span>
            <Combobox
              value={ticket.parentTicket?.id ?? ''}
              onValueChange={(v) =>
                updateTicketDetailMutation.mutate({
                  ticketId,
                  patch: { parentTicketId: v || null },
                })
              }
            >
              <ComboboxInput
                placeholder="No parent ticket"
                showClear={!!ticket.parentTicket}
                className="h-7 text-xs"
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
          </div>

          {/* Sub-tickets */}
          {ticket.childTickets && ticket.childTickets.length > 0 && (
            <div>
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-2">
                Sub-tickets
              </h3>
              <div className="space-y-px">
                {ticket.childTickets.map((child) => (
                  <Link
                    key={child.id}
                    href={`/tickets/${child.id}`}
                    className="flex items-center gap-2 rounded px-2 py-1 text-sm text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-200"
                  >
                    <StatusDot status={child.status} />
                    <span className="truncate">{child.title}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Start work */}
          <div>
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-2">
              Start Work
            </h3>
            <div className="flex gap-2">
              <NativeSelect
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="h-7 flex-1 text-xs"
              >
                <NativeSelectOption value="">Select agent</NativeSelectOption>
                {agentOptions.map((a) => (
                  <NativeSelectOption key={a.id} value={a.id}>
                    {a.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                size="sm"
                className="h-7 text-xs px-3"
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
                {linkedSession ? 'Resume' : 'Start'}
              </Button>
            </div>
          </div>

          {/* Updates timeline */}
          {ticket.updates && ticket.updates.length > 0 && (
            <div>
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-2">
                Updates
              </h3>
              <div className="space-y-2">
                {ticket.updates.map((update) => (
                  <div
                    key={update.id}
                    className="rounded border border-zinc-800/60 bg-white/[0.02] px-3 py-2 text-xs text-zinc-400"
                  >
                    {update.body}
                    <div className="mt-1 text-[10px] text-zinc-600">
                      <RelativeTime timestamp={update.created_at} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Link
            href={`/tickets/${ticketId}`}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-white transition"
          >
            Open full page <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </ScrollArea>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create Ticket Dialog
// ---------------------------------------------------------------------------

function CreateTicketDialog({
  open,
  onOpenChange,
  defaultGoalId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultGoalId?: string | null
}) {
  const utils = trpc.useUtils()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [goalId, setGoalId] = useState<string | null>(defaultGoalId ?? null)
  const [parentTicketId, setParentTicketId] = useState<string | null>(null)
  const [ticketStatus, setTicketStatus] = useState<'inbox' | 'ready'>('ready')
  const [assigneeKind, setAssigneeKind] = useState<ActorKind | ''>('')
  const [assigneeRef, setAssigneeRef] = useState<string | null>(null)

  const goalsQuery = trpc.work.listGoals.useQuery({
    limit: 200,
    includeArchived: false,
    sort: { field: 'title', direction: 'asc' },
  })
  const ticketsQuery = trpc.work.listTickets.useQuery({
    scope: 'all',
    limit: 200,
    sort: { field: 'title', direction: 'asc' },
  })
  const membersQuery = trpc.org.listMembers.useQuery()
  const agentsQuery = trpc.org.listAgents.useQuery()

  const suggestQuery = trpc.work.suggestRelated.useQuery(
    { text: title },
    { enabled: title.trim().length > 5 }
  )
  const suggestions = useMemo(() => suggestQuery.data ?? [], [suggestQuery.data])

  const goalItems = useMemo(
    () => (goalsQuery.data ?? []).map((g) => ({ value: g.id, label: g.title })),
    [goalsQuery.data]
  )
  const parentTicketItems = useMemo(
    () => (ticketsQuery.data ?? []).map((t) => ({ value: t.id, label: t.title })),
    [ticketsQuery.data]
  )
  const userOptions = useMemo(
    () =>
      (membersQuery.data ?? [])
        .filter((m) => m.kind === 'user')
        .map((m) => ({ value: m.id, label: m.name || m.email })),
    [membersQuery.data]
  )
  const agentOptions = useMemo(
    () => (agentsQuery.data ?? []).map((a) => ({ value: a.id, label: a.name })),
    [agentsQuery.data]
  )

  const assigneeRefItems = useMemo(() => {
    if (assigneeKind === 'user') return userOptions
    if (assigneeKind === 'agent') return agentOptions
    return []
  }, [assigneeKind, userOptions, agentOptions])

  const createTicketMutation = trpc.work.createTicket.useMutation({
    onSuccess: async () => {
      setTitle('')
      setBody('')
      setGoalId(defaultGoalId ?? null)
      setParentTicketId(null)
      setTicketStatus('ready')
      setAssigneeKind('')
      setAssigneeRef(null)
      onOpenChange(false)
      await Promise.all([utils.work.listTickets.invalidate(), utils.work.listGoals.invalidate()])
    },
    onError: () => {
      toast.error('Failed to create ticket')
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Ticket</DialogTitle>
          <DialogDescription>Add a piece of work to track.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ticket title"
          />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
          />
          <Combobox value={goalId ?? ''} onValueChange={(v) => setGoalId(v || null)}>
            <ComboboxInput placeholder="No goal" showClear={!!goalId} />
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
          <Combobox
            value={parentTicketId ?? ''}
            onValueChange={(v) => setParentTicketId(v || null)}
          >
            <ComboboxInput placeholder="No parent ticket" showClear={!!parentTicketId} />
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
          <div className="grid gap-2 sm:grid-cols-2">
            <NativeSelect
              value={ticketStatus}
              onChange={(e) => setTicketStatus(e.target.value as 'inbox' | 'ready')}
              className="w-full"
            >
              <NativeSelectOption value="ready">Ready</NativeSelectOption>
              <NativeSelectOption value="inbox">Inbox</NativeSelectOption>
            </NativeSelect>
            <NativeSelect
              value={assigneeKind}
              onChange={(e) => {
                setAssigneeKind(e.target.value as ActorKind | '')
                setAssigneeRef(null)
              }}
              className="w-full"
            >
              <NativeSelectOption value="">No assignee</NativeSelectOption>
              <NativeSelectOption value="user">User</NativeSelectOption>
              <NativeSelectOption value="agent">Agent</NativeSelectOption>
            </NativeSelect>
          </div>
          {assigneeKind ? (
            <Combobox value={assigneeRef ?? ''} onValueChange={(v) => setAssigneeRef(v || null)}>
              <ComboboxInput placeholder="Select assignee" showClear={!!assigneeRef} />
              <ComboboxContent>
                <ComboboxList>
                  {assigneeRefItems.map((item) => (
                    <ComboboxItem key={item.value} value={item.value}>
                      {item.label}
                    </ComboboxItem>
                  ))}
                  <ComboboxEmpty>No matches</ComboboxEmpty>
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          ) : null}
          {suggestions.length > 0 ? (
            <div className="border border-amber-500/20 bg-amber-500/5 p-2.5">
              <p className="mb-1.5 text-xs font-medium text-amber-200">Related open tickets</p>
              {suggestions.map((s) => (
                <Link
                  key={s.id}
                  href={`/tickets/${s.id}`}
                  className="flex items-center justify-between rounded px-2 py-1 text-sm text-zinc-300 transition hover:bg-white/5"
                >
                  <span className="truncate">{s.title}</span>
                  <span className="ml-2 text-[10px] text-zinc-500">score {s.score}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
        <DialogFooter showCloseButton>
          <Button
            onClick={() =>
              createTicketMutation.mutate({
                title,
                body: body || null,
                goalId: goalId || null,
                parentTicketId: parentTicketId || null,
                status: ticketStatus,
                assigneeKind: assigneeKind || null,
                assigneeRef: assigneeRef || null,
              })
            }
            disabled={!title.trim() || createTicketMutation.isPending}
          >
            Create Ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TicketsClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const utils = trpc.useUtils()

  // Query params for cross-surface linking
  const goalIdParam = searchParams.get('goalId')
  const teamParam = searchParams.get('team')
  const assigneeParam = searchParams.get('assignee')
  const viewParam = searchParams.get('view')

  // --- Shared tree hooks ---
  const { selectedId: selectedTicketId, setSelectedId: setSelectedTicketId, clearSelection } = useTreeSelection()

  const [activeViewId, setActiveViewId] = useState(viewParam ?? 'active')
  const [search, setSearch] = useState('')
  const [filterStatuses, setFilterStatuses] = useState<string[]>([])
  const [filterScope, setFilterScope] = useState<'mine' | 'my_team' | 'unclaimed' | 'all'>('all')
  const [filterGoalId, setFilterGoalId] = useState<string | null>(goalIdParam)
  const [filterAssignee, setFilterAssignee] = useState<string | null>(assigneeParam)
  const [createTicketOpen, setCreateTicketOpen] = useState(false)
  const [creatingChildOf, setCreatingChildOf] = useState<string | null>(null)

  const updateTicketMutation = trpc.work.updateTicket.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.work.listTickets.invalidate(), utils.work.listGoals.invalidate()])
    },
    onError: () => {
      toast.error('Failed to update ticket')
    },
  })

  const inlineCreateTicketMutation = trpc.work.createTicket.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.work.listTickets.invalidate(), utils.work.listGoals.invalidate()])
    },
    onError: () => {
      toast.error('Failed to create ticket')
    },
  })

  const inlineCreateSubTicketMutation = trpc.work.createTicket.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.work.listTickets.invalidate(), utils.work.listGoals.invalidate()])
    },
    onError: () => {
      toast.error('Failed to create sub-ticket')
    },
  })

  const handleTicketDelete = useCallback(
    (ticketId: string) => {
      updateTicketMutation.mutate({ ticketId, patch: { status: 'canceled' as TicketStatus } })
    },
    [updateTicketMutation]
  )

  const handleTicketStatusChange = useCallback(
    (ticketId: string, status: string) => {
      updateTicketMutation.mutate({ ticketId, patch: { status: status as TicketStatus } })
    },
    [updateTicketMutation]
  )

  const handleInlineTicketCreate = useCallback(
    (title: string) => {
      inlineCreateTicketMutation.mutate({
        title,
        goalId: filterGoalId || null,
        status: 'ready',
      })
    },
    [inlineCreateTicketMutation, filterGoalId]
  )

  const handleInlineSubTicketCreate = useCallback(
    (title: string, parentTicketId: string) => {
      inlineCreateSubTicketMutation.mutate({
        title,
        parentTicketId,
        status: 'ready',
      })
    },
    [inlineCreateSubTicketMutation]
  )

  // Build filter input
  const activeView = TICKET_VIEWS.find((v) => v.id === activeViewId)

  const ticketFilters = useMemo<TicketListInput>(() => {
    const base = activeView?.filters ?? TICKET_VIEWS[0]!.filters
    return {
      ...base,
      q: search || undefined,
      scope: filterScope !== 'all' ? filterScope : base.scope,
      statuses: filterStatuses.length > 0 ? filterStatuses.filter(isTicketStatus) : base.statuses,
      goalId: filterGoalId ?? undefined,
      assigneeRef: filterAssignee ?? undefined,
    }
  }, [activeView, search, filterScope, filterStatuses, filterGoalId, filterAssignee])

  const ticketsQuery = trpc.work.listTickets.useQuery(ticketFilters)
  const tickets = useMemo(() => ticketsQuery.data ?? [], [ticketsQuery.data])

  // Build tree
  const ticketTree = useMemo(() => buildTicketTree(tickets), [tickets])
  const flatTickets = useMemo(() => flattenTicketTree(ticketTree), [ticketTree])
  const flatIds = useMemo(() => flatTickets.map((t) => t.id), [flatTickets])
  const descendantTicketMap = useMemo(() => buildDescendantTicketMap(ticketTree), [ticketTree])

  // Auto-expand all tickets that have children (old behavior was expanded by default)
  const parentTicketIds = useMemo(
    () => tickets.filter((t) => t.childTicketCount > 0).map((t) => t.id),
    [tickets]
  )
  const { isExpanded, toggle: toggleExpand } = useTreeExpand({ autoExpandIds: parentTicketIds })

  // --- Reorder mutation ---
  const reorderTicketMutation = trpc.work.reorderTicket.useMutation({
    onMutate: async ({ ticketId, newParentTicketId, sortOrder }) => {
      await utils.work.listTickets.cancel()
      const previous = utils.work.listTickets.getData(ticketFilters)
      if (previous) {
        utils.work.listTickets.setData(
          ticketFilters,
          applyOptimisticReorder(
            previous,
            ticketId,
            newParentTicketId,
            sortOrder,
            (t) => t.id,
            (t) => t.parentTicketId,
            (t) => t.sortOrder,
            (t, pid) => ({ ...t, parentTicketId: pid }),
            (t, so) => ({ ...t, sortOrder: so }),
          ),
        )
      }
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        utils.work.listTickets.setData(ticketFilters, ctx.previous)
      }
      toast.error('Failed to reorder ticket')
    },
    onSettled: () => {
      void Promise.all([utils.work.listTickets.invalidate(), utils.work.listGoals.invalidate()])
    },
  })

  // --- Drag/drop helpers ---
  const getSiblingOrder = useCallback(
    (parentId: string | null) => {
      const toEntry = (n: TicketTreeNode) => ({ id: n.ticket.id, sortOrder: n.ticket.sortOrder })
      if (parentId === null) {
        return ticketTree.map(toEntry)
      }
      // Walk the tree to find the parent node's children
      function findChildren(nodes: TicketTreeNode[]): { id: string; sortOrder: number }[] | null {
        for (const node of nodes) {
          if (node.ticket.id === parentId) {
            return node.children.map(toEntry)
          }
          const found = findChildren(node.children)
          if (found) return found
        }
        return null
      }
      return findChildren(ticketTree) ?? []
    },
    [ticketTree]
  )

  const getParentId = useCallback(
    (ticketId: string): string | null => {
      const ticket = tickets.find((t) => t.id === ticketId)
      return ticket?.parentTicketId ?? null
    },
    [tickets]
  )

  // --- Drag/drop hook ---
  const handleTicketDrop = useCallback(
    (draggedId: string, targetParentId: string | null, sortOrder: number | null) => {
      reorderTicketMutation.mutate({
        ticketId: draggedId,
        newParentTicketId: targetParentId,
        sortOrder: sortOrder ?? 0,
      })
    },
    [reorderTicketMutation]
  )

  const {
    draggedId,
    dragTargetId,
    rootDropOver,
    dropPosition,
    startDrag,
    endDrag,
    getRowDragHandlers,
    getGroupEndDropHandlers,
    getRootDropHandlers,
  } = useTreeDragDrop({
    descendantMap: descendantTicketMap,
    onDrop: handleTicketDrop,
    toastErrorMessage: 'A ticket cannot be moved under one of its own children',
    getSiblingOrder,
    getParentId,
    isExpandedWithChildren: (id: string) => {
      const hasKids = (descendantTicketMap.get(id)?.size ?? 0) > 0
      return hasKids && isExpanded(id)
    },
  })

  // --- Inline editing hook ---
  const { editingId, startEdit, cancelEdit, commitEdit } = useTreeInlineEdit({
    onCommit: (ticketId, title) => {
      updateTicketMutation.mutate({ ticketId, patch: { title } })
    },
  })

  // --- Keyboard nav hook ---
  const handleCycleStatus = useCallback(
    (id: string) => {
      const ticket = tickets.find((t) => t.id === id)
      if (ticket) {
        const idx = ALL_TICKET_STATUSES.indexOf(ticket.status as TicketStatus)
        const nextStatus = ALL_TICKET_STATUSES[(idx + 1) % ALL_TICKET_STATUSES.length]
        if (nextStatus) handleTicketStatusChange(id, nextStatus)
      }
    },
    [tickets, handleTicketStatusChange]
  )

  const extraKeys = useMemo(
    () => ({ s: handleCycleStatus }),
    [handleCycleStatus]
  )

  useTreeKeyboardNav({
    flatIds,
    selectedId: selectedTicketId,
    onSelect: setSelectedTicketId,
    onClear: clearSelection,
    onStartEdit: startEdit,
    onOpen: (id) => router.push(`/tickets/${id}`),
    onCreate: () => setCreateTicketOpen(true),
    extraKeys,
  })

  function clearUrlParam(key: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.delete(key)
    const newUrl = params.toString() ? `?${params.toString()}` : '/tickets'
    router.replace(newUrl)
  }

  function applyView(viewId: string) {
    setActiveViewId(viewId)
    setSearch('')
    setFilterStatuses([])
    setFilterScope('all')
    setFilterAssignee(null)
    clearSelection()
    // Clear URL params
    if (assigneeParam || viewParam) {
      const params = new URLSearchParams(searchParams.toString())
      params.delete('assignee')
      params.delete('view')
      const newUrl = params.toString() ? `?${params.toString()}` : '/tickets'
      router.replace(newUrl)
    }
  }

  function clearGoalFilter() {
    setFilterGoalId(null)
    clearUrlParam('goalId')
  }

  function clearAssigneeFilter() {
    setFilterAssignee(null)
    clearUrlParam('assignee')
  }

  // Fetch goal name for filter badge
  const goalFilterQuery = trpc.work.getGoal.useQuery(
    { goalId: filterGoalId! },
    { enabled: !!filterGoalId }
  )

  // --- Build breadcrumb segments ---
  const breadcrumbSegments = useMemo(() => {
    const segments: { label: string; onClear?: () => void }[] = [
      { label: activeView?.name ?? 'Active' },
    ]
    if (filterGoalId && goalFilterQuery.data) {
      segments.push({ label: goalFilterQuery.data.title, onClear: clearGoalFilter })
    }
    if (filterAssignee) {
      segments.push({ label: 'Assignee filtered', onClear: clearAssigneeFilter })
    }
    if (filterStatuses.length > 0 || filterScope !== 'all' || search) {
      segments.push({
        label: `Filtered (${filterStatuses.length + (filterScope !== 'all' ? 1 : 0) + (search ? 1 : 0)})`,
        onClear: () => {
          setSearch('')
          setFilterStatuses([])
          setFilterScope('all')
        },
      })
    }
    return segments
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, filterGoalId, goalFilterQuery.data, filterAssignee, filterStatuses, filterScope, search])

  // --- Filter popover slot ---
  const filterSlot = (
    <Popover>
      <PopoverTrigger
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition',
          filterStatuses.length > 0 || filterScope !== 'all' || filterGoalId || filterAssignee
            ? 'border-white/20 bg-white/[0.06] text-white'
            : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
        )}
      >
        <Filter className="h-3 w-3" />
        Filter
        {(filterStatuses.length > 0 ||
          filterScope !== 'all' ||
          filterGoalId ||
          filterAssignee) && (
          <span className="inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-white/15 px-1 text-[9px] font-medium text-white">
            {filterStatuses.length +
              (filterScope !== 'all' ? 1 : 0) +
              (filterGoalId ? 1 : 0) +
              (filterAssignee ? 1 : 0)}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3 p-3" align="end">
        <div>
          <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Status
          </label>
          <div className="mt-1 flex flex-wrap gap-1">
            {ALL_TICKET_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  if (filterStatuses.includes(s)) {
                    setFilterStatuses(filterStatuses.filter((x) => x !== s))
                  } else {
                    setFilterStatuses([...filterStatuses, s])
                  }
                }}
                className={cn(
                  'flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] transition',
                  filterStatuses.includes(s)
                    ? 'border-white/20 bg-white/10 text-white'
                    : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'
                )}
              >
                <StatusDot status={s} className="h-1.5 w-1.5" />
                {statusLabel(s)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Scope
          </label>
          <NativeSelect
            value={filterScope}
            onChange={(e) =>
              setFilterScope(e.target.value as 'mine' | 'my_team' | 'unclaimed' | 'all')
            }
            className="mt-1 h-7 w-full text-xs"
          >
            <NativeSelectOption value="all">All</NativeSelectOption>
            <NativeSelectOption value="mine">Mine</NativeSelectOption>
            <NativeSelectOption value="my_team">My Team</NativeSelectOption>
            <NativeSelectOption value="unclaimed">Unclaimed</NativeSelectOption>
          </NativeSelect>
        </div>
      </PopoverContent>
    </Popover>
  )

  // Render ticket list
  function renderList() {
    if (ticketTree.length === 0) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
          <Ticket className="h-8 w-8 text-zinc-700" />
          <p className="text-sm text-zinc-500">Nothing in this view. Press c to add a ticket.</p>
          <p className="text-xs text-zinc-600">
            Press{' '}
            <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1 py-0.5 font-mono text-[10px] text-zinc-500">
              c
            </kbd>{' '}
            to create a ticket.
          </p>
        </div>
      )
    }

    return (
      <div className="pb-32">
        <TreeRootDropZone
          active={!!draggedId}
          isOver={rootDropOver}
          handlers={getRootDropHandlers()}
        />
        <TicketTreeRows
          nodes={ticketTree}
          depth={0}
          selectedTicketId={selectedTicketId}
          onSelect={setSelectedTicketId}
          onTicketStatusChange={handleTicketStatusChange}
          onTicketDelete={handleTicketDelete}
          onInlineSubTicketCreate={handleInlineSubTicketCreate}
          inlineSubTicketPending={inlineCreateSubTicketMutation.isPending}
          showGoalTag={!filterGoalId}
          isExpanded={isExpanded}
          onToggle={toggleExpand}
          draggedId={draggedId}
          dragTargetId={dragTargetId}
          dropPosition={dropPosition}
          startDrag={startDrag}
          endDrag={endDrag}
          getRowDragHandlers={getRowDragHandlers}
          getGroupEndDropHandlers={getGroupEndDropHandlers}
          editingId={editingId}
          onStartEdit={startEdit}
          onCommitEdit={commitEdit}
          onCancelEdit={cancelEdit}
          creatingChildOf={creatingChildOf}
          setCreatingChildOf={setCreatingChildOf}
        />
        <InlineCreateRow
          placeholder="New ticket..."
          isPending={inlineCreateTicketMutation.isPending}
          onSubmit={handleInlineTicketCreate}
        />
      </div>
    )
  }

  // --- Detail panel ---
  const detailPanel = selectedTicketId ? (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end border-b border-zinc-800 px-2 py-1">
        <button
          type="button"
          onClick={clearSelection}
          className="rounded p-1 text-zinc-500 hover:text-white transition"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <TicketDetailPanel ticketId={selectedTicketId} />
      </div>
    </div>
  ) : null

  return (
    <div className="flex h-full flex-col">
      <TreeToolbar
        views={TICKET_VIEWS.map((v) => ({ id: v.id, name: v.name }))}
        activeViewId={activeViewId}
        onViewChange={applyView}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search tickets..."
        filterSlot={filterSlot}
        onCreateClick={() => setCreateTicketOpen(true)}
      />

      <TreeBreadcrumb
        root="Tickets"
        onRootClick={() => applyView('active')}
        segments={breadcrumbSegments}
      />

      <TreeDetailLayout
        tree={ticketsQuery.isLoading ? <SkeletonTreeRows /> : renderList()}
        detail={detailPanel}
        detailWidth="400px"
      />

      {/* Create dialog */}
      <CreateTicketDialog
        open={createTicketOpen}
        onOpenChange={setCreateTicketOpen}
        defaultGoalId={filterGoalId}
      />
    </div>
  )
}
