'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IconChevronDown,
  IconHierarchy,
  IconMessageCircle,
  IconPencil,
  IconTicket,
} from '@tabler/icons-react'
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Link2 } from 'lucide-react'
import { trpc, type RouterOutputs } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { RelativeTime } from '@/app/(app)/components/RelativeTime'
import {
  describeHeartbeatSchedule,
  HeartbeatScheduleEditor,
} from '@/app/(app)/work/HeartbeatScheduleEditor'
import { SkeletonGoalDetail } from '@/app/(app)/work/skeletons'
import { toast } from 'sonner'
import {
  type ActorKind,
  ALL_GOAL_STATUSES,
  ALL_TICKET_STATUSES,
  type InlinePickerItem,
  InlinePicker,
  InlineStatusPicker,
  ProgressRing,
  type GoalStatus,
  type TicketStatus,
} from '@/app/(app)/work/shared'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// contentEditable heading — cursor lands where you click, zero layout shift
// ---------------------------------------------------------------------------

function InlineEditableHeading({
  value,
  onSave,
  placeholder = 'Untitled',
}: {
  value: string
  onSave: (v: string) => void
  placeholder?: string
}) {
  const ref = useRef<HTMLHeadingElement>(null)
  const saved = useRef(value)

  useEffect(() => {
    if (!ref.current || document.activeElement === ref.current) return
    if (ref.current.textContent !== value) {
      ref.current.textContent = value
    }
    saved.current = value
  }, [value])

  // Set initial text
  useEffect(() => {
    if (ref.current && !ref.current.textContent) {
      ref.current.textContent = value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commit = useCallback(() => {
    const text = ref.current?.textContent?.trim() ?? ''
    if (text && text !== saved.current) {
      saved.current = text
      onSave(text)
    } else if (!text && ref.current) {
      ref.current.textContent = saved.current
    }
  }, [onSave])

  return (
    <h1
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ref.current?.blur()
        }
        if (e.key === 'Escape') {
          if (ref.current) ref.current.textContent = saved.current
          ref.current?.blur()
        }
      }}
      data-placeholder={placeholder}
      className="min-h-[1.75rem] cursor-text text-xl font-semibold tracking-tight text-white outline-none empty:before:text-zinc-600 empty:before:content-[attr(data-placeholder)]"
    />
  )
}

// ---------------------------------------------------------------------------
// contentEditable paragraph — for outcome / description
// ---------------------------------------------------------------------------

function InlineEditableText({
  value,
  onSave,
  placeholder = 'Add a description...',
}: {
  value: string
  onSave: (v: string) => void
  placeholder?: string
}) {
  const ref = useRef<HTMLParagraphElement>(null)
  const saved = useRef(value)

  useEffect(() => {
    if (!ref.current || document.activeElement === ref.current) return
    if (ref.current.textContent !== value) {
      ref.current.textContent = value || ''
    }
    saved.current = value
  }, [value])

  useEffect(() => {
    if (ref.current && ref.current.textContent === '' && value) {
      ref.current.textContent = value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commit = useCallback(() => {
    const text = ref.current?.textContent?.trim() ?? ''
    if (text !== saved.current) {
      saved.current = text
      onSave(text || 'TBD')
    }
  }, [onSave])

  return (
    <p
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          if (ref.current) ref.current.textContent = saved.current
          ref.current?.blur()
        }
      }}
      data-placeholder={placeholder}
      className="min-h-[1.25rem] cursor-text text-sm leading-relaxed text-white/50 outline-none empty:before:text-zinc-600 empty:before:content-[attr(data-placeholder)]"
    />
  )
}

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type GoalDetail = RouterOutputs['work']['getGoal']
type GoalChildRow = GoalDetail['childGoals'][number]
type GoalTicketRow = GoalDetail['tickets'][number]
type GoalUpdateRow = GoalDetail['updates'][number]

type GoalChildNode = { goal: GoalChildRow; children: GoalChildNode[] }
type GoalTicketNode = { ticket: GoalTicketRow; children: GoalTicketNode[] }

type GoalProgressSource =
  | 'ticket_rollup'
  | 'sub_goal_rollup'
  | 'number'
  | 'currency'
  | 'percentage'
  | 'boolean'

const PROGRESS_SOURCE_OPTIONS: Array<{ value: GoalProgressSource; label: string }> = [
  { value: 'ticket_rollup', label: 'Ticket rollup' },
  { value: 'sub_goal_rollup', label: 'Sub-goal rollup' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'boolean', label: 'Boolean' },
]

function withCurrentOption<T extends { value: string; label: string }>(
  items: T[],
  current: T | null
) {
  if (!current || items.some((item) => item.value === current.value)) return items
  return [current, ...items]
}

function formatGoalProgressSummary(goal: GoalDetail) {
  const source = (goal.progressSource ?? 'ticket_rollup') as GoalProgressSource
  switch (source) {
    case 'ticket_rollup':
      return {
        value: 'Rolls up from child tickets',
        hint:
          goal.tickets.length > 0
            ? `${goal.tickets.filter((t) => t.status === 'done').length}/${goal.tickets.length} tickets done`
            : 'No child tickets yet',
      }
    case 'sub_goal_rollup':
      return {
        value: 'Rolls up from sub-goals',
        hint:
          goal.childGoals.length > 0
            ? `${goal.childGoals.filter((c) => c.status === 'done').length}/${goal.childGoals.length} sub-goals done`
            : 'No sub-goals yet',
      }
    case 'percentage':
      return {
        value: `${goal.progressCurrent ?? 0}% of ${goal.progressTarget ?? 100}%`,
        hint: 'Manual percentage target',
      }
    case 'currency': {
      const unit = goal.progressUnit?.trim() || 'USD'
      return {
        value: `${goal.progressCurrent ?? 0} / ${goal.progressTarget ?? 0} ${unit}`,
        hint: 'Manual currency target',
      }
    }
    case 'number': {
      const unit = goal.progressUnit?.trim()
      return {
        value: `${goal.progressCurrent ?? 0} / ${goal.progressTarget ?? 0}${unit ? ` ${unit}` : ''}`,
        hint: 'Manual numeric target',
      }
    }
    case 'boolean':
      return {
        value: goal.progressCurrent ? 'Complete' : 'Not complete',
        hint: 'Binary completion check',
      }
    default:
      return { value: 'Progress not configured', hint: null }
  }
}

function formatUpdateKindLabel(kind: GoalUpdateRow['kind']) {
  switch (kind) {
    case 'status':
      return 'Status'
    case 'heartbeat':
      return 'Heartbeat'
    default:
      return 'Update'
  }
}

function formatUpdateAuthorLabel(update: GoalUpdateRow) {
  if (update.source === 'system') return 'System'
  return update.author?.label ?? (update.author_kind === 'agent' ? 'Agent' : 'Someone')
}

// ---------------------------------------------------------------------------
// Tree builders
// ---------------------------------------------------------------------------

function buildGoalChildTree(goals: GoalChildRow[]): GoalChildNode[] {
  const map = new Map<string, GoalChildNode>()
  for (const g of goals) map.set(g.id, { goal: g, children: [] })
  const roots: GoalChildNode[] = []
  for (const g of goals) {
    const node = map.get(g.id)!
    if (g.parentGoalId && map.has(g.parentGoalId)) {
      map.get(g.parentGoalId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sort = (nodes: GoalChildNode[]) => {
    nodes.sort((a, b) => a.goal.sortOrder - b.goal.sortOrder)
    nodes.forEach((n) => sort(n.children))
  }
  sort(roots)
  return roots
}

function buildGoalTicketTree(tickets: GoalTicketRow[]): GoalTicketNode[] {
  const map = new Map<string, GoalTicketNode>()
  for (const t of tickets) map.set(t.id, { ticket: t, children: [] })
  const roots: GoalTicketNode[] = []
  for (const t of tickets) {
    const node = map.get(t.id)!
    if (t.parentTicketId && map.has(t.parentTicketId)) {
      map.get(t.parentTicketId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sort = (nodes: GoalTicketNode[]) => {
    nodes.sort((a, b) => a.ticket.sortOrder - b.ticket.sortOrder)
    nodes.forEach((n) => sort(n.children))
  }
  sort(roots)
  return roots
}

function collectExpandedIds<T extends { children: T[] }>(
  nodes: T[],
  getId: (n: T) => string
): Set<string> {
  const ids = new Set<string>()
  const walk = (entries: T[]) => {
    for (const entry of entries) {
      if (entry.children.length > 0) {
        ids.add(getId(entry))
        walk(entry.children)
      }
    }
  }
  walk(nodes)
  return ids
}

// ---------------------------------------------------------------------------
// Tree row components
// ---------------------------------------------------------------------------

function GoalTicketTreeRow({
  node,
  depth,
  expandedIds,
  onToggle,
  onStatusChange,
}: {
  node: GoalTicketNode
  depth: number
  expandedIds: Set<string>
  onToggle: (id: string) => void
  onStatusChange: (id: string, status: string) => void
}) {
  const pl = 16 + depth * 20
  const hasKids = node.children.length > 0
  const open = expandedIds.has(node.ticket.id)

  return (
    <>
      <div
        className="group flex items-center gap-2.5 border-t border-zinc-800/60 py-2 pr-4 transition first:border-t-0 hover:bg-white/[0.03]"
        style={{ paddingLeft: pl }}
      >
        {hasKids ? (
          <button
            type="button"
            onClick={() => onToggle(node.ticket.id)}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-600 transition hover:text-zinc-300"
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="inline-block h-4 w-4 shrink-0" />
        )}
        <InlineStatusPicker
          currentStatus={node.ticket.status}
          statuses={ALL_TICKET_STATUSES}
          onStatusChange={(s) => onStatusChange(node.ticket.id, s)}
        />
        <Link
          href={`/tickets/${node.ticket.id}`}
          className="min-w-0 flex-1 truncate text-sm text-white/85 transition group-hover:text-white"
        >
          {node.ticket.title}
        </Link>
        <span className="shrink-0 text-xs text-white/30 tabular-nums">
          ${node.ticket.receiptSummary?.totalCostUsd.toFixed(2) ?? '0.00'}
        </span>
      </div>
      {hasKids && open
        ? node.children.map((child) => (
            <GoalTicketTreeRow
              key={child.ticket.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onStatusChange={onStatusChange}
            />
          ))
        : null}
    </>
  )
}

function GoalChildTreeRow({
  node,
  depth,
  expandedIds,
  onToggle,
  onStatusChange,
}: {
  node: GoalChildNode
  depth: number
  expandedIds: Set<string>
  onToggle: (id: string) => void
  onStatusChange: (id: string, status: string) => void
}) {
  const pl = 16 + depth * 20
  const hasKids = node.children.length > 0
  const open = expandedIds.has(node.goal.id)

  return (
    <>
      <div
        className="group flex items-center gap-2.5 border-t border-zinc-800/60 py-2 pr-4 transition first:border-t-0 hover:bg-white/[0.03]"
        style={{ paddingLeft: pl }}
      >
        {hasKids ? (
          <button
            type="button"
            onClick={() => onToggle(node.goal.id)}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-600 transition hover:text-zinc-300"
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="inline-block h-4 w-4 shrink-0" />
        )}
        <InlineStatusPicker
          currentStatus={node.goal.status}
          statuses={ALL_GOAL_STATUSES}
          onStatusChange={(s) => onStatusChange(node.goal.id, s)}
        />
        <Link
          href={`/goals/${node.goal.id}`}
          className="min-w-0 flex-1 truncate text-sm text-white/85 transition group-hover:text-white"
        >
          {node.goal.title}
        </Link>
        <ProgressRing
          percent={node.goal.progressPercent ?? 0}
          health={node.goal.health}
          size={16}
          strokeWidth={2}
        />
      </div>
      {hasKids && open
        ? node.children.map((child) => (
            <GoalChildTreeRow
              key={child.goal.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onStatusChange={onStatusChange}
            />
          ))
        : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// Sidebar property row
// ---------------------------------------------------------------------------

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-24 shrink-0 text-xs text-white/35">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Write update dialog
// ---------------------------------------------------------------------------

function WriteUpdateDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (body: string) => void
  isPending: boolean
}) {
  const [body, setBody] = useState('')

  useEffect(() => {
    if (open) setBody('')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Write update</DialogTitle>
        </DialogHeader>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Leave a note, status update, or checkpoint."
          rows={4}
          autoFocus
          className="resize-y"
        />
        <DialogFooter>
          <Button
            size="sm"
            onClick={() => {
              if (body.trim()) onSubmit(body.trim())
            }}
            disabled={!body.trim() || isPending}
          >
            Post update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Progress settings (inline expandable)
// ---------------------------------------------------------------------------

function ProgressSettings({
  goal,
  progressSource,
  setProgressSource,
  progressCurrent,
  setProgressCurrent,
  progressTarget,
  setProgressTarget,
  progressUnit,
  setProgressUnit,
  onSave,
  className,
}: {
  goal: GoalDetail
  progressSource: GoalProgressSource
  setProgressSource: (v: GoalProgressSource) => void
  progressCurrent: string
  setProgressCurrent: (v: string) => void
  progressTarget: string
  setProgressTarget: (v: string) => void
  progressUnit: string
  setProgressUnit: (v: string) => void
  onSave: (patch: Record<string, unknown>) => void
  className?: string
}) {
  return (
    <div
      className={cn('space-y-2 rounded-lg border border-zinc-800/60 bg-zinc-950/30 p-3', className)}
    >
      <InlinePicker
        value={progressSource}
        items={PROGRESS_SOURCE_OPTIONS}
        placeholder="Select source"
        onValueChange={(v) => {
          const source = v as GoalProgressSource
          setProgressSource(source)
          onSave({ progressSource: source })
        }}
      />
      {(progressSource === 'number' ||
        progressSource === 'currency' ||
        progressSource === 'percentage') && (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            placeholder="Current"
            value={progressCurrent}
            onChange={(e) => setProgressCurrent(e.target.value)}
            onBlur={() =>
              onSave({
                progressCurrent: progressCurrent ? Number(progressCurrent) : null,
                progressTarget: progressTarget ? Number(progressTarget) : null,
                progressUnit: progressUnit || null,
              })
            }
            className="h-7 w-20 text-xs"
          />
          <span className="text-xs text-zinc-500">/</span>
          <Input
            type="number"
            placeholder="Target"
            value={progressTarget}
            onChange={(e) => setProgressTarget(e.target.value)}
            onBlur={() =>
              onSave({
                progressCurrent: progressCurrent ? Number(progressCurrent) : null,
                progressTarget: progressTarget ? Number(progressTarget) : null,
                progressUnit: progressUnit || null,
              })
            }
            className="h-7 w-20 text-xs"
          />
          {(progressSource === 'number' || progressSource === 'currency') && (
            <Input
              placeholder="Unit"
              value={progressUnit}
              onChange={(e) => setProgressUnit(e.target.value)}
              onBlur={() => onSave({ progressUnit: progressUnit || null })}
              className="h-7 w-20 text-xs"
            />
          )}
        </div>
      )}
      {progressSource === 'boolean' && (
        <InlinePicker
          value={String(goal.progressCurrent ?? 0)}
          items={[
            { value: '0', label: 'Not complete' },
            { value: '1', label: 'Complete' },
          ]}
          placeholder="Select"
          onValueChange={(v) => onSave({ progressCurrent: Number(v) })}
        />
      )}
      {(progressSource === 'ticket_rollup' || progressSource === 'sub_goal_rollup') && (
        <p className="text-xs text-zinc-500">{formatGoalProgressSummary(goal).hint}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GoalDetailClient({ goalId }: { goalId: string }) {
  const router = useRouter()
  const utils = trpc.useUtils()

  // Tab + UI state
  const [activeTab, setActiveTab] = useState<string>('overview')
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [progressSource, setProgressSource] = useState<GoalProgressSource>('ticket_rollup')
  const [progressCurrent, setProgressCurrent] = useState('')
  const [progressTarget, setProgressTarget] = useState('')
  const [progressUnit, setProgressUnit] = useState('')
  const [heartbeatCronExpr, setHeartbeatCronExpr] = useState('0 9 * * 1-5')
  const [heartbeatTimezone, setHeartbeatTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  )
  const [newTicketTitle, setNewTicketTitle] = useState('')
  const [newChildGoalTitle, setNewChildGoalTitle] = useState('')
  const [subGoalComposerOpen, setSubGoalComposerOpen] = useState(false)
  const [expandedTicketIds, setExpandedTicketIds] = useState<Set<string>>(new Set())
  const [expandedGoalIds, setExpandedGoalIds] = useState<Set<string>>(new Set())

  // Queries
  const goalQuery = trpc.work.getGoal.useQuery({ goalId })
  const agentsQuery = trpc.org.listAgents.useQuery()
  const membersQuery = trpc.org.listMembers.useQuery()
  const goalsForParentQuery = trpc.work.listGoals.useQuery({
    limit: 200,
    includeArchived: false,
    sort: { field: 'title', direction: 'asc' },
  })
  const heartbeatQuery = trpc.work.getHeartbeatConfig.useQuery({
    targetKind: 'goal',
    targetId: goalId,
  })
  const relatedSessionsQuery = trpc.sessions.listRelated.useQuery({
    goalId,
    limit: 6,
  })

  // Mutations
  const invalidateGoal = useCallback(async () => {
    await Promise.all([
      utils.work.getGoal.invalidate({ goalId }),
      utils.work.getHeartbeatConfig.invalidate({ targetKind: 'goal', targetId: goalId }),
      utils.work.listGoals.invalidate(),
      utils.work.getDashboard.invalidate(),
    ])
  }, [utils, goalId])

  const updateGoalMutation = trpc.work.updateGoal.useMutation({
    onSuccess: invalidateGoal,
    onError: () => toast.error('Failed to update goal'),
  })

  const postUpdateMutation = trpc.work.postWorkUpdate.useMutation({
    onSuccess: async () => {
      setUpdateDialogOpen(false)
      await invalidateGoal()
    },
    onError: () => toast.error('Failed to post update'),
  })

  const createTicketMutation = trpc.work.createTicket.useMutation({
    onSuccess: async () => {
      setNewTicketTitle('')
      toast.success('Ticket created')
      await invalidateGoal()
    },
    onError: () => toast.error('Failed to create ticket'),
  })

  const createChildGoalMutation = trpc.work.createGoal.useMutation({
    onSuccess: async () => {
      setNewChildGoalTitle('')
      setSubGoalComposerOpen(false)
      toast.success('Sub-goal created')
      await invalidateGoal()
    },
    onError: () => toast.error('Failed to create sub-goal'),
  })

  const updateTicketStatusMutation = trpc.work.updateTicket.useMutation({
    onSuccess: () => utils.work.getGoal.invalidate({ goalId }),
    onError: () => toast.error('Failed to update ticket status'),
  })

  const heartbeatMutation = trpc.work.upsertHeartbeat.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.getGoal.invalidate({ goalId }),
        utils.work.getHeartbeatConfig.invalidate({ targetKind: 'goal', targetId: goalId }),
        utils.work.listUpdates.invalidate(),
        utils.work.getDashboard.invalidate(),
      ])
    },
    onError: () => toast.error('Failed to save heartbeat'),
  })
  const startGoalSessionMutation = trpc.sessions.create.useMutation({
    onSuccess: ({ sessionKey }) => {
      router.push(`/sessions/${encodeURIComponent(sessionKey)}`)
    },
    onError: () => toast.error('Failed to start goal conversation'),
  })

  // Derived data
  const goal = goalQuery.data
  const heartbeatConfig = heartbeatQuery.data
  const ticketTree = useMemo(() => buildGoalTicketTree(goal?.tickets ?? []), [goal?.tickets])
  const childGoalTree = useMemo(
    () => buildGoalChildTree(goal?.childGoals ?? []),
    [goal?.childGoals]
  )
  const authoredUpdates = useMemo(
    () => (goal?.updates ?? []).filter((update) => update.source === 'authored'),
    [goal?.updates]
  )
  const latestAuthoredUpdate = authoredUpdates[0] ?? null
  const parentGoalItems = useMemo(
    () =>
      withCurrentOption(
        (goalsForParentQuery.data ?? [])
          .filter((e) => e.id !== goalId)
          .map<InlinePickerItem>((e) => ({
            value: e.id,
            label: e.title,
            trailing: (
              <ProgressRing
                percent={e.progressPercent ?? 0}
                health={e.health}
                size={14}
                strokeWidth={2}
              />
            ),
          })),
        goal?.parentGoal
          ? {
              value: goal.parentGoal.id,
              label: goal.parentGoal.title,
            }
          : null
      ),
    [goalsForParentQuery.data, goalId, goal?.parentGoal]
  )
  const userOptions = useMemo(
    () =>
      withCurrentOption(
        (membersQuery.data ?? [])
          .filter((m) => m.kind === 'user')
          .map((m) => ({ value: m.id, label: m.name || m.email })),
        goal?.owner?.kind === 'user' ? { value: goal.owner.ref, label: goal.owner.label } : null
      ),
    [membersQuery.data, goal?.owner]
  )
  const agentOwnerOptions = useMemo(
    () =>
      withCurrentOption(
        (agentsQuery.data ?? []).map((a) => ({ value: a.id, label: a.name, hint: a.roleName })),
        goal?.owner?.kind === 'agent'
          ? { value: goal.owner.ref, label: goal.owner.label, hint: goal.owner.title }
          : null
      ),
    [agentsQuery.data, goal?.owner]
  )

  // Sync state from fetched data
  useEffect(() => {
    if (!goal) return
    setProgressSource((goal.progressSource ?? 'ticket_rollup') as GoalProgressSource)
    setProgressCurrent(goal.progressCurrent == null ? '' : String(goal.progressCurrent))
    setProgressTarget(goal.progressTarget == null ? '' : String(goal.progressTarget))
    setProgressUnit(goal.progressUnit ?? '')
  }, [goal])

  useEffect(() => {
    if (!heartbeatQuery.data) return
    setHeartbeatCronExpr(heartbeatQuery.data.cronExpr ?? '0 9 * * 1-5')
    setHeartbeatTimezone(
      heartbeatQuery.data.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
    )
  }, [heartbeatQuery.data])

  useEffect(() => {
    setExpandedTicketIds(collectExpandedIds(ticketTree, (n) => n.ticket.id))
  }, [ticketTree])

  useEffect(() => {
    setExpandedGoalIds(collectExpandedIds(childGoalTree, (n) => n.goal.id))
  }, [childGoalTree])

  // Helpers
  const patch = useCallback(
    (p: Parameters<typeof updateGoalMutation.mutate>[0]['patch']) => {
      updateGoalMutation.mutate({ goalId, patch: p })
    },
    [updateGoalMutation, goalId]
  )

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Loading / error states
  if (goalQuery.isLoading) return <SkeletonGoalDetail />

  if (goalQuery.error || !goal) {
    return (
      <div className="mx-auto max-w-4xl py-12 text-center">
        <h1 className="text-xl font-semibold text-white">
          {goalQuery.error ? "Couldn't load this goal." : 'Goal not found.'}
        </h1>
        <p className="mt-2 text-sm text-white/50">
          {goalQuery.error?.message || 'This goal may have been archived or removed.'}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/goals">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to goals
            </Button>
          </Link>
          {goalQuery.error && (
            <Button size="sm" onClick={() => goalQuery.refetch()}>
              Try again
            </Button>
          )}
        </div>
      </div>
    )
  }

  const doneTicketCount = goal.tickets.filter((t) => t.status === 'done').length
  const doneChildGoalCount = goal.childGoals.filter((c) => c.status === 'done').length
  const ticketSubtotalCostUsd = goal.tickets.reduce(
    (sum, ticket) => sum + (ticket.receiptSummary?.totalCostUsd ?? 0),
    0
  )
  const goalTotalCostUsd = goal.rollup?.totalCostUsd ?? ticketSubtotalCostUsd
  const goalConversationAgentId = goal.owner?.kind === 'agent' ? goal.owner.ref : null
  const progressSummary = formatGoalProgressSummary(goal)
  const ownerTitle = goal.owner?.kind === 'agent' ? (goal.owner.title ?? null) : null
  const ownerIsAgent = goal.owner?.kind === 'agent'
  const savedHeartbeatCronExpr = heartbeatConfig?.cronExpr ?? '0 9 * * 1-5'
  const hasUnsavedStewardshipChanges =
    !!heartbeatConfig && ownerIsAgent && heartbeatCronExpr.trim() !== savedHeartbeatCronExpr.trim()
  const stewardshipScheduleLabel = !ownerIsAgent
    ? 'Needs agent owner'
    : heartbeatConfig
      ? `${heartbeatConfig.enabled ? '' : 'Paused · '}${describeHeartbeatSchedule(savedHeartbeatCronExpr)}`
      : 'Off'
  const stewardshipHelperLabel = ownerIsAgent
    ? ownerTitle
      ? `Runs as ${goal.owner?.label} (${ownerTitle})`
      : `Runs as ${goal.owner?.label}`
    : 'Assign an agent owner to enable the recurring loop.'

  // =========================================================================
  // Inline pickers (popover-based, same feel as status picker)
  // =========================================================================

  const ownerPicker = (
    <InlinePicker
      value={goal.owner?.ref ?? null}
      placeholder="Unassigned"
      tabs={[
        { key: 'user', label: 'People', items: userOptions },
        { key: 'agent', label: 'Agents', items: agentOwnerOptions },
      ]}
      onValueChange={(v) => {
        // Determine kind from which tab the value belongs to
        const isAgent = agentOwnerOptions.some((o) => o.value === v)
        const kind: ActorKind = isAgent ? 'agent' : 'user'
        patch({ ownerKind: kind, ownerRef: v })
      }}
      onClear={() => patch({ ownerKind: null, ownerRef: null })}
    />
  )

  const parentGoalPicker = (
    <InlinePicker
      value={goal.parentGoal?.id ?? null}
      items={parentGoalItems}
      placeholder="None"
      onValueChange={(v) => patch({ parentGoalId: v || null })}
      onClear={() => patch({ parentGoalId: null })}
    />
  )

  const stewardshipEditor = (
    <div className="space-y-3">
      <div className="rounded-md border border-zinc-800/60 bg-zinc-950/30 p-2.5 text-xs text-white/45">
        <p>{stewardshipScheduleLabel}</p>
        <p className="mt-0.5">{stewardshipHelperLabel}</p>
        {hasUnsavedStewardshipChanges ? (
          <p className="mt-1 text-[11px] text-amber-200/80">
            Draft: {describeHeartbeatSchedule(heartbeatCronExpr)}
          </p>
        ) : null}
        {heartbeatConfig?.nextRunAt ? (
          hasUnsavedStewardshipChanges ? (
            <>
              <p className="mt-1 text-[11px] text-white/30">
                Saved schedule runs next <RelativeTime timestamp={heartbeatConfig.nextRunAt} />
              </p>
              <p className="mt-1 text-[11px] text-white/30">Next run updates after you save.</p>
            </>
          ) : (
            <p className="mt-1 text-[11px] text-white/30">
              Next <RelativeTime timestamp={heartbeatConfig.nextRunAt} />
            </p>
          )
        ) : heartbeatConfig ? (
          <p className="mt-1 text-[11px] text-white/30">Paused</p>
        ) : null}
      </div>

      {ownerIsAgent ? (
        <HeartbeatScheduleEditor
          cronExpr={heartbeatCronExpr}
          onCronExprChange={setHeartbeatCronExpr}
        />
      ) : (
        <div className="rounded-md border border-dashed border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/40">
          Stewardship follows the goal owner. Assign an agent as owner to turn this on.
        </div>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1 text-xs"
          onClick={() =>
            heartbeatMutation.mutate({
              targetKind: 'goal',
              targetId: goalId,
              cronExpr: heartbeatCronExpr,
              timezone: heartbeatTimezone,
              enabled: true,
            })
          }
          disabled={
            !ownerIsAgent ||
            !heartbeatCronExpr.trim() ||
            !heartbeatTimezone.trim() ||
            heartbeatMutation.isPending ||
            (!!heartbeatConfig && !hasUnsavedStewardshipChanges)
          }
        >
          {ownerIsAgent ? (heartbeatConfig ? 'Save changes' : 'Enable') : 'Assign agent owner'}
        </Button>
        {heartbeatConfig && ownerIsAgent ? (
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={() =>
              heartbeatMutation.mutate({
                targetKind: 'goal',
                targetId: goalId,
                cronExpr: heartbeatCronExpr,
                timezone: heartbeatTimezone,
                enabled: !heartbeatConfig.enabled,
              })
            }
            disabled={heartbeatMutation.isPending}
          >
            {heartbeatConfig.enabled ? 'Pause' : 'Resume'}
          </Button>
        ) : null}
      </div>
    </div>
  )

  const renderStewardshipProperty = () => (
    <Popover
      onOpenChange={(open) => {
        if (!open) {
          setHeartbeatCronExpr(heartbeatConfig?.cronExpr ?? '0 9 * * 1-5')
          setHeartbeatTimezone(
            heartbeatConfig?.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
          )
        }
      }}
    >
      <PopoverTrigger className="group/stewardship flex w-full min-w-0 items-center gap-2 text-left text-xs text-white/50 transition hover:text-white/75">
        <span className="min-w-0 flex-1 truncate">{stewardshipScheduleLabel}</span>
        <IconChevronDown className="h-3 w-3 shrink-0 transition group-hover/stewardship:text-white/60" />
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-3" align="end">
        {stewardshipEditor}
      </PopoverContent>
    </Popover>
  )

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <div className="mx-auto max-w-6xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-white/40">
        <Link
          href="/goals"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition hover:bg-white/5 hover:text-white/75"
        >
          Goals
        </Link>
        {goal.parentGoal && (
          <>
            <ChevronRight className="h-3 w-3" />
            <Link
              href={`/goals/${goal.parentGoal.id}`}
              className="rounded-md px-2 py-1 transition hover:bg-white/5 hover:text-white/75"
            >
              {goal.parentGoal.title}
            </Link>
          </>
        )}
        <ChevronRight className="h-3 w-3" />
        <span className="text-white/60">{goal.title}</span>
        <button
          type="button"
          className="ml-auto rounded p-1 text-white/25 transition hover:bg-white/5 hover:text-white/50"
          onClick={() => {
            void navigator.clipboard.writeText(window.location.href)
            toast.success('Link copied')
          }}
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>
      </nav>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as string)} className="mt-3">
        <TabsList variant="line" className="gap-0">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="updates">
            Updates
            {goal.updates.length > 0 && (
              <span className="ml-1.5 text-[10px] tabular-nums text-white/30">
                {goal.updates.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="tickets">
            Tickets
            {goal.tickets.length > 0 && (
              <span className="ml-1.5 text-[10px] tabular-nums text-white/30">
                {goal.tickets.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Two-column layout wrapping all tab content */}
        <div className="mt-4 flex gap-8">
          {/* Main column */}
          <div className="min-w-0 flex-1">
            {/* ============= OVERVIEW TAB ============= */}
            <TabsContent value="overview" className="mt-0">
              <div className="space-y-6">
                {/* Title + outcome */}
                <div className="space-y-1">
                  <div className="flex items-start gap-3">
                    <ProgressRing
                      percent={goal.progressPercent ?? 0}
                      health={goal.health}
                      size={28}
                      strokeWidth={3}
                    />
                    <div className="min-w-0 flex-1">
                      <InlineEditableHeading
                        value={goal.title}
                        onSave={(title) => patch({ title })}
                        placeholder="Goal title"
                      />
                      <InlineEditableText
                        value={goal.outcome && goal.outcome !== 'TBD' ? goal.outcome : ''}
                        onSave={(outcome) => patch({ outcome })}
                        placeholder="Set the outcome so this goal has a concrete finish line."
                      />
                    </div>
                  </div>
                </div>

                {/* Inline properties bar */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                  <InlineStatusPicker
                    currentStatus={goal.status}
                    statuses={ALL_GOAL_STATUSES}
                    onStatusChange={(s) => patch({ status: s as GoalStatus })}
                    showLabel
                  />
                  <div className="flex items-center gap-1.5">
                    <span className="text-white/35">Owner</span>
                    {ownerPicker}
                    {ownerTitle ? <span className="text-white/25">{ownerTitle}</span> : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-white/35">Stewardship</span>
                    {renderStewardshipProperty()}
                  </div>
                  <span className="text-white/25">
                    Updated <RelativeTime timestamp={goal.updatedAt} />
                  </span>
                </div>

                {/* Completed banner */}
                {goal.status === 'done' && (
                  <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100/85">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>Goal landed. Updates below are for closeout notes.</p>
                  </div>
                )}

                {/* Latest authored update */}
                {latestAuthoredUpdate ? (
                  <section className="rounded-xl border border-zinc-800/70 bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                        Latest update
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2.5 text-xs text-white/45 hover:text-white/80"
                        onClick={() => setUpdateDialogOpen(true)}
                      >
                        <IconPencil className="mr-1.5 h-3.5 w-3.5" />
                        Update
                      </Button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <Badge
                        variant="outline"
                        className="border-zinc-700/80 bg-zinc-900/70 text-[10px] text-white/65"
                      >
                        {formatUpdateKindLabel(latestAuthoredUpdate.kind)}
                      </Badge>
                      <span className="text-white/65">
                        {formatUpdateAuthorLabel(latestAuthoredUpdate)}
                      </span>
                      <span className="text-white/25">
                        <RelativeTime timestamp={latestAuthoredUpdate.created_at} />
                      </span>
                    </div>
                    <p className="mt-4 text-base leading-8 text-white/82 whitespace-pre-wrap">
                      {latestAuthoredUpdate.body}
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('updates')}
                      className="mt-4 text-xs text-white/35 transition hover:text-white/60"
                    >
                      See journal
                    </button>
                  </section>
                ) : (
                  <button
                    type="button"
                    onClick={() => setUpdateDialogOpen(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-800 py-3 text-sm text-white/35 transition hover:border-zinc-700 hover:bg-white/[0.02] hover:text-white/50"
                  >
                    <IconPencil className="h-4 w-4" />
                    Write first update
                  </button>
                )}

                {/* Sub-goals */}
                {childGoalTree.length > 0 ? (
                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <IconHierarchy className="h-3.5 w-3.5 text-zinc-500" />
                        <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                          Sub-goals ({doneChildGoalCount}/{goal.childGoals.length})
                        </span>
                      </div>
                    </div>

                    <div className="rounded-lg border border-zinc-800/40">
                      {childGoalTree.map((child) => (
                        <GoalChildTreeRow
                          key={child.goal.id}
                          node={child}
                          depth={0}
                          expandedIds={expandedGoalIds}
                          onToggle={(id) => toggleSet(setExpandedGoalIds, id)}
                          onStatusChange={(childId, status) =>
                            updateGoalMutation.mutate({
                              goalId: childId,
                              patch: { status: status as GoalStatus },
                            })
                          }
                        />
                      ))}
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        const title = newChildGoalTitle.trim()
                        if (!title) return
                        createChildGoalMutation.mutate({
                          title,
                          outcome: 'TBD',
                          parentGoalId: goalId,
                        })
                      }}
                      className="mt-2"
                    >
                      <input
                        placeholder="Add sub-goal..."
                        value={newChildGoalTitle}
                        onChange={(e) => setNewChildGoalTitle(e.target.value)}
                        className="h-7 w-full border-0 bg-transparent text-sm text-zinc-300 placeholder:text-zinc-600 outline-none"
                      />
                    </form>
                  </section>
                ) : (
                  <div className="space-y-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => setSubGoalComposerOpen(true)}
                    >
                      + Goal
                    </Button>
                    {subGoalComposerOpen && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          const title = newChildGoalTitle.trim()
                          if (!title) return
                          createChildGoalMutation.mutate({
                            title,
                            outcome: 'TBD',
                            parentGoalId: goalId,
                          })
                        }}
                      >
                        <input
                          placeholder="Add sub-goal..."
                          value={newChildGoalTitle}
                          onChange={(e) => setNewChildGoalTitle(e.target.value)}
                          onBlur={() => {
                            if (!newChildGoalTitle.trim()) setSubGoalComposerOpen(false)
                          }}
                          autoFocus
                          className="h-7 w-full border-0 bg-transparent text-sm text-zinc-300 placeholder:text-zinc-600 outline-none"
                        />
                      </form>
                    )}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ============= UPDATES TAB ============= */}
            <TabsContent value="updates" className="mt-0">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                    Updates Journal
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => setUpdateDialogOpen(true)}
                  >
                    <IconPencil className="h-3 w-3" />
                    Write update
                  </Button>
                </div>

                {goal.updates.length > 0 ? (
                  <div className="space-y-4">
                    {goal.updates.map((update) =>
                      update.source === 'authored' ? (
                        <div
                          key={update.id}
                          className="rounded-xl border border-zinc-800/60 bg-white/[0.02] p-4"
                        >
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <Badge
                              variant="outline"
                              className="border-zinc-700/80 bg-zinc-900/70 text-[10px] text-white/65"
                            >
                              {formatUpdateKindLabel(update.kind)}
                            </Badge>
                            <span className="text-white/65">{formatUpdateAuthorLabel(update)}</span>
                            <span className="text-white/25">
                              <RelativeTime timestamp={update.created_at} />
                            </span>
                          </div>
                          <p className="mt-3 text-sm leading-7 text-white/78 whitespace-pre-wrap">
                            {update.body}
                          </p>
                        </div>
                      ) : (
                        <div
                          key={update.id}
                          className="flex items-start gap-3 rounded-lg border border-zinc-900 bg-zinc-950/40 px-3 py-2.5"
                        >
                          <IconMessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/18" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/30">
                              <span className="uppercase tracking-[0.18em] text-white/22">
                                {formatUpdateKindLabel(update.kind)}
                              </span>
                              <span>System</span>
                              <span>
                                <RelativeTime timestamp={update.created_at} />
                              </span>
                            </div>
                            <p className="mt-1 text-sm leading-6 text-white/42 whitespace-pre-wrap">
                              {update.body}
                            </p>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-white/30">
                    No updates yet. Drop a checkpoint when the work shifts.
                  </p>
                )}
              </div>
            </TabsContent>

            {/* ============= TICKETS TAB ============= */}
            <TabsContent value="tickets" className="mt-0">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <IconTicket className="h-3.5 w-3.5 text-zinc-500" />
                    <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/30">
                      Tickets
                      {goal.tickets.length > 0
                        ? ` (${doneTicketCount}/${goal.tickets.length})`
                        : ''}
                    </span>
                  </div>
                  {goal.tickets.length > 0 && (
                    <span className="text-xs text-zinc-500 tabular-nums">
                      ${ticketSubtotalCostUsd.toFixed(2)}{' '}
                      cost
                    </span>
                  )}
                </div>

                {ticketTree.length > 0 ? (
                  <div className="rounded-lg border border-zinc-800/40">
                    {ticketTree.map((node) => (
                      <GoalTicketTreeRow
                        key={node.ticket.id}
                        node={node}
                        depth={0}
                        expandedIds={expandedTicketIds}
                        onToggle={(id) => toggleSet(setExpandedTicketIds, id)}
                        onStatusChange={(ticketId, status) =>
                          updateTicketStatusMutation.mutate({
                            ticketId,
                            patch: { status: status as TicketStatus },
                          })
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <p className="py-8 text-center text-xs text-zinc-600">
                    No tickets yet. Tickets carry the execution.
                  </p>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!newTicketTitle.trim()) return
                    createTicketMutation.mutate({
                      goalId,
                      title: newTicketTitle,
                      status: 'ready',
                    })
                  }}
                  className="mt-2"
                >
                  <input
                    placeholder="Add ticket..."
                    value={newTicketTitle}
                    onChange={(e) => setNewTicketTitle(e.target.value)}
                    className="h-7 w-full border-0 bg-transparent text-sm text-zinc-300 placeholder:text-zinc-600 outline-none"
                  />
                </form>
              </div>
            </TabsContent>
          </div>

          {/* ============= SIDEBAR ============= */}
          <aside className="hidden w-72 shrink-0 lg:block">
            <div className="space-y-6">
              {/* Properties */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                    Properties
                  </span>
                </div>
                <div className="divide-y divide-zinc-800/40">
                  <PropRow label="Status">
                    <InlineStatusPicker
                      currentStatus={goal.status}
                      statuses={ALL_GOAL_STATUSES}
                      onStatusChange={(s) => patch({ status: s as GoalStatus })}
                      showLabel
                    />
                  </PropRow>
                  <PropRow label="Owner">
                    <div className="space-y-0.5">
                      {ownerPicker}
                      {ownerTitle ? (
                        <p className="text-[10px] text-white/25">{ownerTitle}</p>
                      ) : null}
                    </div>
                  </PropRow>
                  <PropRow label="Parent">{parentGoalPicker}</PropRow>
                  <PropRow label="Stewardship">{renderStewardshipProperty()}</PropRow>
                  <PropRow label="Progress">
                    <Popover>
                      <PopoverTrigger className="group/progress flex min-w-0 items-center gap-1.5 text-xs text-white/50 transition hover:text-white/75">
                        <ProgressRing
                          percent={goal.progressPercent ?? 0}
                          health={goal.health}
                          size={14}
                          strokeWidth={2}
                        />
                        <span className="truncate">{progressSummary.value}</span>
                        <IconChevronDown className="h-3 w-3 shrink-0 transition group-hover/progress:text-white/60" />
                      </PopoverTrigger>
                      <PopoverContent className="w-[280px] p-2.5" align="end">
                        <ProgressSettings
                          goal={goal}
                          progressSource={progressSource}
                          setProgressSource={setProgressSource}
                          progressCurrent={progressCurrent}
                          setProgressCurrent={setProgressCurrent}
                          progressTarget={progressTarget}
                          setProgressTarget={setProgressTarget}
                          progressUnit={progressUnit}
                          setProgressUnit={setProgressUnit}
                          onSave={(p) => patch(p as Parameters<typeof patch>[0])}
                          className="border-0 bg-transparent p-0"
                        />
                      </PopoverContent>
                    </Popover>
                  </PropRow>
                  <PropRow label="Updated">
                    <span className="text-xs text-white/40">
                      <RelativeTime timestamp={goal.updatedAt} />
                    </span>
                  </PropRow>
                </div>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                    Conversations
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-[11px]"
                    disabled={!goalConversationAgentId || startGoalSessionMutation.isPending}
                    onClick={() => {
                      if (!goalConversationAgentId) return
                      startGoalSessionMutation.mutate({
                        goalId,
                        primaryAgentId: goalConversationAgentId,
                        title: goal.title,
                      })
                    }}
                  >
                    {startGoalSessionMutation.isPending ? 'Starting…' : 'Start session'}
                  </Button>
                </div>
                {relatedSessionsQuery.data?.items.length ? (
                  <div className="space-y-1">
                    {relatedSessionsQuery.data.items.slice(0, 4).map((session) => (
                      <Link
                        key={session.sessionKey}
                        href={`/sessions/${encodeURIComponent(session.sessionKey)}`}
                        className="block rounded-md px-2 py-1.5 transition hover:bg-white/[0.04]"
                      >
                        <div className="truncate text-xs text-white/70">{session.displayTitle}</div>
                        <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-white/30">
                          <span className="truncate">{session.context.label}</span>
                          <span className="shrink-0">
                            <RelativeTime timestamp={session.lastActivityAt} />
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs leading-5 text-white/35">
                    {goalConversationAgentId
                      ? 'No goal conversations yet. Start one to create a fresh session for this goal.'
                      : 'Assign an agent owner to start goal conversations.'}
                  </p>
                )}
              </section>

              {/* Sub-goals summary */}
              {goal.childGoals.length > 0 && (
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                      Sub-goals
                    </span>
                    <span className="text-[10px] tabular-nums text-white/25">
                      {doneChildGoalCount}/{goal.childGoals.length}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {childGoalTree.map((child) => (
                      <Link
                        key={child.goal.id}
                        href={`/goals/${child.goal.id}`}
                        className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-white/[0.04]"
                      >
                        <InlineStatusPicker
                          currentStatus={child.goal.status}
                          statuses={ALL_GOAL_STATUSES}
                          onStatusChange={(s) =>
                            updateGoalMutation.mutate({
                              goalId: child.goal.id,
                              patch: { status: s as GoalStatus },
                            })
                          }
                        />
                        <span className="min-w-0 flex-1 truncate text-xs text-white/60 group-hover:text-white/80">
                          {child.goal.title}
                        </span>
                        <ProgressRing
                          percent={child.goal.progressPercent ?? 0}
                          health={child.goal.health}
                          size={14}
                          strokeWidth={2}
                        />
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {/* Ticket progress */}
              {goal.tickets.length > 0 && (
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                      Progress
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-white/40">Scope</span>
                      <span className="tabular-nums text-white/60">{goal.tickets.length}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/40">Completed</span>
                      <span className="tabular-nums text-white/60">{doneTicketCount}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/40">Cost</span>
                      <span className="tabular-nums text-white/60">
                        $
                        {goalTotalCostUsd.toFixed(2)}
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{
                          width: `${goal.tickets.length > 0 ? (doneTicketCount / goal.tickets.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                </section>
              )}
            </div>
          </aside>
        </div>
      </Tabs>

      {/* Write update dialog */}
      <WriteUpdateDialog
        open={updateDialogOpen}
        onOpenChange={setUpdateDialogOpen}
        onSubmit={(body) => postUpdateMutation.mutate({ goalId, body })}
        isPending={postUpdateMutation.isPending}
      />
    </div>
  )
}
