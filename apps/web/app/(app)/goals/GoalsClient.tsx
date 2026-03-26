'use client'

import Link from 'next/link'
import { Fragment, useCallback, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowRight, MoreHorizontal, Target, X } from 'lucide-react'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { RelativeTime } from '../components/RelativeTime'
import {
  type ActorKind,
  type GoalStatus,
  type GoalListInput,
  ALL_GOAL_STATUSES,
  OPEN_GOAL_STATUSES,
  DEFAULT_SORT,
  statusLabel,
  isGoalStatus,
  StatusDot,
  InlineStatusPicker,
  AvatarCircle,
  TicketProgress,
  ProgressRing,
  formatMetricValue,
  InlineCreateRow,
} from '../work/shared'
import { SkeletonTreeRows } from '../work/skeletons'
import {
  useTreeSelection,
  useAutoSelectFirst,
  useTreeExpand,
  useTreeDragDrop,
  useTreeKeyboardNav,
  useTreeInlineEdit,
  useIsDesktop,
  applyOptimisticReorder,
} from '../work/tree-hooks'
import type { DropPosition } from '../work/tree-hooks'
import {
  TreeRootDropZone,
  TreeGroupEndDropZone,
  TreeToolbar,
  TreeRow,
  TreeDetailLayout,
  InlineEditInput,
} from '../work/tree-components'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GoalRow = RouterOutputs['work']['listGoals'][number]

// Progress fields may not be on GoalRow type yet (router agent is adding them).
// This helper extracts them safely without scattering `as any` across the UI.
function getProgressFields(goal: Record<string, unknown>): {
  progressPercent: number
  progressSource: string | undefined
  progressCurrent: number | null
  progressTarget: number | null
  progressUnit: string | null
} {
  const g = goal
  return {
    progressPercent: typeof g.progressPercent === 'number' ? g.progressPercent : 0,
    progressSource: typeof g.progressSource === 'string' ? g.progressSource : undefined,
    progressCurrent: typeof g.progressCurrent === 'number' ? g.progressCurrent : null,
    progressTarget: typeof g.progressTarget === 'number' ? g.progressTarget : null,
    progressUnit: typeof g.progressUnit === 'string' ? g.progressUnit : null,
  }
}

type GoalTreeNode = {
  goal: GoalRow
  children: GoalTreeNode[]
}

type GoalView = {
  id: string
  name: string
  filters: GoalListInput
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOAL_VIEWS: GoalView[] = [
  {
    id: 'active',
    name: 'Active',
    filters: { statuses: ['active', 'at_risk'], limit: 200, sort: DEFAULT_SORT },
  },
  {
    id: 'all',
    name: 'All',
    filters: { statuses: OPEN_GOAL_STATUSES, limit: 200, sort: DEFAULT_SORT },
  },
  {
    id: 'blocked',
    name: 'Blocked',
    filters: { statuses: ['blocked', 'at_risk'], limit: 200, sort: DEFAULT_SORT },
  },
  {
    id: 'draft',
    name: 'Draft',
    filters: { statuses: ['draft'], limit: 200, sort: DEFAULT_SORT },
  },
]

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

function buildGoalTree(goals: GoalRow[]): GoalTreeNode[] {
  const goalMap = new Map<string, GoalTreeNode>()
  for (const goal of goals) {
    goalMap.set(goal.id, { goal, children: [] })
  }
  const roots: GoalTreeNode[] = []
  for (const goal of goals) {
    const node = goalMap.get(goal.id)!
    if (goal.parentGoalId && goalMap.has(goal.parentGoalId)) {
      goalMap.get(goal.parentGoalId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  // Sort children by sort_order
  const sortChildren = (nodes: GoalTreeNode[]) => {
    nodes.sort((a, b) => a.goal.sortOrder - b.goal.sortOrder)
    for (const node of nodes) {
      sortChildren(node.children)
    }
  }
  sortChildren(roots)
  return roots
}

function flattenGoalTree(nodes: GoalTreeNode[]): GoalRow[] {
  const result: GoalRow[] = []
  for (const node of nodes) {
    result.push(node.goal)
    result.push(...flattenGoalTree(node.children))
  }
  return result
}

function buildDescendantGoalMap(nodes: GoalTreeNode[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()

  function walk(node: GoalTreeNode): Set<string> {
    const descendants = new Set<string>()
    for (const child of node.children) {
      descendants.add(child.goal.id)
      for (const grandchild of walk(child)) {
        descendants.add(grandchild)
      }
    }
    map.set(node.goal.id, descendants)
    return descendants
  }

  for (const node of nodes) {
    walk(node)
  }

  return map
}

function healthBorderColor(health: string): string {
  switch (health) {
    case 'healthy':
      return 'border-l-emerald-500/40'
    case 'at_risk':
      return 'border-l-amber-500/40'
    case 'blocked':
      return 'border-l-red-500/40'
    default:
      return 'border-l-zinc-700/40'
  }
}

// ---------------------------------------------------------------------------
// Goal tree row (recursive)
// ---------------------------------------------------------------------------

function GoalTreeRow({
  node,
  depth,
  selectedId,
  expandedIds,
  onToggle,
  onSelect,
  onStatusChange,
  onArchive,
  onInlineSubGoalCreate,
  inlineSubGoalPending,
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
  node: GoalTreeNode
  depth: number
  selectedId: string | null
  expandedIds: Set<string>
  onToggle: (id: string) => void
  onSelect: (id: string) => void
  onStatusChange: (goalId: string, status: string) => void
  onArchive: (goalId: string) => void
  onInlineSubGoalCreate: (title: string, parentGoalId: string) => void
  inlineSubGoalPending: boolean
  draggedId: string | null
  dragTargetId: string | null
  dropPosition: DropPosition
  startDrag: (id: string, event: React.DragEvent) => void
  endDrag: () => void
  getRowDragHandlers: (rowId: string) =>
    | {
        onDragOver: (event: React.DragEvent) => void
        onDragEnter: (event: React.DragEvent) => void
        onDragLeave: () => void
        onDrop: (event: React.DragEvent) => void
      }
    | undefined
  getGroupEndDropHandlers: (parentRowId: string) =>
    | {
        onDragOver: (event: React.DragEvent) => void
        onDragEnter: (event: React.DragEvent) => void
        onDragLeave: () => void
        onDrop: (event: React.DragEvent) => void
      }
    | undefined
  editingId: string | null
  onStartEdit: (id: string) => void
  onCommitEdit: (id: string, value: string) => void
  onCancelEdit: () => void
  creatingChildOf: string | null
  setCreatingChildOf: (id: string | null) => void
}) {
  const goal = node.goal
  const hasChildren = node.children.length > 0 || goal.childGoalCount > 0
  const expanded = expandedIds.has(goal.id)
  const isRoot = depth === 0
  const isEditing = editingId === goal.id

  const totalTickets = goal.ticketCounts.total
  const doneTickets = goal.ticketCounts.done

  const { progressPercent, progressSource, progressCurrent, progressTarget, progressUnit } =
    getProgressFields(goal)

  return (
    <div className={cn(isRoot && 'border-l-2', isRoot && healthBorderColor(goal.health))}>
      <TreeRow
        twoLine
        id={goal.id}
        depth={depth}
        isSelected={selectedId === goal.id}
        isExpanded={expanded}
        hasChildren={hasChildren}
        isDragging={draggedId === goal.id}
        isDragTarget={dragTargetId === goal.id}
        dropPosition={dropPosition}
        isEditing={isEditing}
        onToggle={() => onToggle(goal.id)}
        onSelect={() => onSelect(goal.id)}
        onDoubleClick={() => onStartEdit(goal.id)}
        onDragStart={(e) => startDrag(goal.id, e)}
        onDragEnd={endDrag}
        dragHandlers={getRowDragHandlers(goal.id)}
        onAddChild={() => setCreatingChildOf(goal.id)}
        secondaryContent={
          <>
            {/* Metric readout */}
            {progressSource === 'number' || progressSource === 'currency' ? (
              <span className="text-xs text-zinc-500 tabular-nums">
                {progressSource === 'currency' ? '$' : ''}
                {formatMetricValue(progressCurrent ?? 0)} /{' '}
                {progressSource === 'currency' ? '$' : ''}
                {formatMetricValue(progressTarget ?? 0)}
                {progressUnit ? ` ${progressUnit}` : ''}
              </span>
            ) : progressSource === 'percentage' ? (
              <span className="text-xs text-zinc-500 tabular-nums">
                {Math.round(progressPercent)}%
              </span>
            ) : progressSource === 'boolean' ? (
              <span className="text-xs text-zinc-500">
                {(progressCurrent ?? 0) >= 1 ? 'Done' : 'Not done'}
              </span>
            ) : progressSource === 'ticket_rollup' && totalTickets > 0 ? (
              <span className="text-xs text-zinc-500 tabular-nums">
                {doneTickets}/{totalTickets} tickets
              </span>
            ) : progressSource === 'sub_goal_rollup' ? (
              <span className="text-xs text-zinc-500 tabular-nums">
                {Math.round(progressPercent)}%
                {goal.childGoalCount > 0
                  ? ` (${goal.childGoalCount} sub-goal${goal.childGoalCount !== 1 ? 's' : ''})`
                  : ''}
              </span>
            ) : totalTickets > 0 ? (
              <span className="text-xs text-zinc-500 tabular-nums">
                {doneTickets}/{totalTickets} tickets
              </span>
            ) : null}

            {goal.childGoalCount > 0 && progressSource !== 'sub_goal_rollup' && (
              <span className="text-[10px] text-zinc-600 tabular-nums">
                {goal.childGoalCount} sub-goal{goal.childGoalCount !== 1 ? 's' : ''}
              </span>
            )}

            {goal.owner ? <AvatarCircle name={goal.owner.label} /> : null}

            <span className="text-[11px] text-zinc-600 tabular-nums">
              <RelativeTime timestamp={goal.updatedAt} />
            </span>
          </>
        }
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Open actions for ${goal.title}`}
              className="mr-2 inline-flex shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity hover:bg-white/[0.04] hover:text-white focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  if (window.confirm(`Archive goal "${goal.title}"?`)) {
                    onArchive(goal.id)
                  }
                }}
              >
                Archive goal
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <ProgressRing percent={progressPercent} health={goal.health} />
        <InlineStatusPicker
          currentStatus={goal.status}
          statuses={ALL_GOAL_STATUSES}
          onStatusChange={(s) => onStatusChange(goal.id, s)}
          showLabel
        />
        {isEditing ? (
          <InlineEditInput
            id={goal.id}
            defaultValue={goal.title}
            onCommit={onCommitEdit}
            onCancel={onCancelEdit}
            className={cn('min-w-0 flex-1', isRoot ? 'font-semibold' : 'font-medium')}
          />
        ) : (
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm',
              isRoot ? 'font-semibold text-zinc-200' : 'font-medium text-zinc-300'
            )}
          >
            {goal.title}
          </span>
        )}
      </TreeRow>

      {/* Inline create row for adding a child of this goal */}
      {creatingChildOf === goal.id && (
        <InlineCreateRow
          placeholder="New sub-goal..."
          depth={depth + 1}
          isPending={inlineSubGoalPending}
          autoFocus
          onSubmit={(title) => {
            onInlineSubGoalCreate(title, goal.id)
            setCreatingChildOf(null)
          }}
          onCancel={() => setCreatingChildOf(null)}
        />
      )}

      {/* Children */}
      {expanded &&
        node.children.map((child) => (
          <GoalTreeRow
            key={child.goal.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            expandedIds={expandedIds}
            onToggle={onToggle}
            onSelect={onSelect}
            onStatusChange={onStatusChange}
            onArchive={onArchive}
            onInlineSubGoalCreate={onInlineSubGoalCreate}
            inlineSubGoalPending={inlineSubGoalPending}
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
        ))}
      {/* Drop zone after group: "after this parent as sibling" */}
      {expanded && node.children.length > 0 && (
        <TreeGroupEndDropZone
          active={!!draggedId}
          depth={depth}
          handlers={getGroupEndDropHandlers(goal.id)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Goal detail panel (right side)
// ---------------------------------------------------------------------------

function GoalDetailPanel({ goalId, onClose }: { goalId: string; onClose: () => void }) {
  const utils = trpc.useUtils()
  const goalQuery = trpc.work.getGoal.useQuery({ goalId })
  const goal = goalQuery.data

  const goalsForParentQuery = trpc.work.listGoals.useQuery({
    limit: 200,
    includeArchived: false,
    sort: { field: 'title', direction: 'asc' },
  })

  const parentGoalItems = useMemo(
    () =>
      (goalsForParentQuery.data ?? [])
        .filter((g) => g.id !== goalId)
        .map((g) => ({ value: g.id, label: g.title })),
    [goalsForParentQuery.data, goalId]
  )

  const updateGoalMutation = trpc.work.updateGoal.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.getGoal.invalidate({ goalId }),
        utils.work.listGoals.invalidate(),
      ])
    },
    onError: () => {
      toast.error('Failed to update goal')
    },
  })

  const panelCreateSubGoalMutation = trpc.work.createGoal.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.getGoal.invalidate({ goalId }),
        utils.work.listGoals.invalidate(),
      ])
    },
    onError: () => {
      toast.error('Failed to create sub-goal')
    },
  })

  if (goalQuery.isLoading || !goal) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center border-b border-zinc-800 px-4">
          <div className="h-4 w-32 animate-pulse rounded bg-zinc-800" />
        </div>
        <div className="space-y-4 p-4">
          <div className="h-3 w-20 animate-pulse rounded bg-zinc-800" />
          <div className="h-3 w-48 animate-pulse rounded bg-zinc-800" />
          <div className="grid grid-cols-[100px_1fr] gap-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Fragment key={i}>
                <div className="h-3 w-16 animate-pulse rounded bg-zinc-800" />
                <div className="h-3 w-32 animate-pulse rounded bg-zinc-800" />
              </Fragment>
            ))}
          </div>
          <div className="h-3 w-24 animate-pulse rounded bg-zinc-800" />
          <div className="h-20 animate-pulse rounded bg-zinc-800/50" />
        </div>
      </div>
    )
  }

  const totalTickets = goal.ticketCounts.total
  const doneTickets = goal.ticketCounts.done

  const { progressPercent, progressSource, progressCurrent, progressTarget, progressUnit } =
    getProgressFields(goal)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
        <div className="flex items-center gap-2 min-w-0">
          <InlineStatusPicker
            currentStatus={goal.status}
            statuses={ALL_GOAL_STATUSES}
            onStatusChange={(s) =>
              updateGoalMutation.mutate({ goalId, patch: { status: s as GoalStatus } })
            }
          />
          <input
            key={goal.title}
            defaultValue={goal.title}
            onBlur={(e) => {
              const trimmed = e.target.value.trim()
              if (trimmed && trimmed !== goal.title) {
                updateGoalMutation.mutate({ goalId, patch: { title: trimmed } })
              } else {
                e.target.value = goal.title
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                ;(e.target as HTMLInputElement).value = goal.title
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            className="min-w-0 flex-1 truncate border-0 bg-transparent text-sm font-medium text-zinc-200 outline-none placeholder:text-zinc-600 focus:text-white"
          />
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/goals/${goalId}`}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-zinc-400 transition hover:bg-white/[0.06] hover:text-white"
          >
            Open
            <ArrowRight className="h-3 w-3" />
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-zinc-500 hover:text-white transition"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4">
          {/* Properties */}
          <div className="grid grid-cols-[100px_1fr] gap-y-2.5 text-sm">
            <span className="text-zinc-500">Health</span>
            <div className="flex items-center gap-1.5">
              <ProgressRing percent={progressPercent} health={goal.health} />
              <span className="text-zinc-300">{statusLabel(goal.health)}</span>
            </div>

            <span className="text-zinc-500">Progress</span>
            <div className="flex flex-col gap-1.5">
              {/* Progress bar */}
              <div className="flex items-center gap-2">
                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={cn(
                      'absolute inset-y-0 left-0 rounded-full transition-all',
                      goal.health === 'blocked'
                        ? 'bg-red-500'
                        : goal.health === 'at_risk'
                          ? 'bg-amber-500'
                          : goal.status === 'done'
                            ? 'bg-emerald-500'
                            : 'bg-blue-500'
                    )}
                    style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }}
                  />
                </div>
                <span className="text-xs text-zinc-400 tabular-nums">
                  {Math.round(progressPercent)}%
                </span>
              </div>
              {/* Source + metric */}
              <span className="text-xs text-zinc-500">
                {progressSource === 'ticket_rollup'
                  ? `${doneTickets}/${totalTickets} tickets`
                  : progressSource === 'sub_goal_rollup'
                    ? `${goal.childGoals?.length ?? 0} sub-goals`
                    : progressSource === 'number' || progressSource === 'currency'
                      ? `${progressSource === 'currency' ? '$' : ''}${formatMetricValue(progressCurrent ?? 0)} / ${progressSource === 'currency' ? '$' : ''}${formatMetricValue(progressTarget ?? 0)}${progressUnit ? ` ${progressUnit}` : ''}`
                      : progressSource === 'boolean'
                        ? (progressCurrent ?? 0) >= 1
                          ? 'Done'
                          : 'Not done'
                        : progressSource === 'percentage'
                          ? `${Math.round(progressPercent)}%`
                          : 'No tracking set'}
              </span>
            </div>

            <span className="text-zinc-500">Owner</span>
            <span className="text-zinc-300">{goal.owner ? goal.owner.label : 'Unassigned'}</span>

            <span className="text-zinc-500">Parent goal</span>
            <Combobox
              value={goal.parentGoal?.id ?? ''}
              onValueChange={(v) =>
                updateGoalMutation.mutate({
                  goalId,
                  patch: { parentGoalId: v || null },
                })
              }
            >
              <ComboboxInput
                placeholder="No parent goal"
                showClear={!!goal.parentGoal}
                className="h-7 text-xs"
              />
              <ComboboxContent>
                <ComboboxList>
                  {parentGoalItems.map((item) => (
                    <ComboboxItem key={item.value} value={item.value}>
                      {item.label}
                    </ComboboxItem>
                  ))}
                  <ComboboxEmpty>No goals found</ComboboxEmpty>
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>

          {/* Outcome */}
          {goal.outcome && goal.outcome !== 'TBD' && (
            <div>
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1">
                Outcome
              </h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{goal.outcome}</p>
            </div>
          )}

          {/* Ticket summary */}
          <div>
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-2">
              Tickets
            </h3>
            {totalTickets > 0 ? (
              <div className="flex items-center gap-3">
                <TicketProgress done={doneTickets} total={totalTickets} />
                <Link
                  href={`/tickets?goalId=${goalId}`}
                  className="text-xs text-zinc-500 hover:text-white transition"
                >
                  View in Work
                </Link>
              </div>
            ) : (
              <p className="text-xs text-zinc-600">No tickets yet.</p>
            )}
          </div>

          {/* Child goals */}
          <div>
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-2">
              Sub-goals
              {goal.childGoals && goal.childGoals.length > 0 ? ` (${goal.childGoals.length})` : ''}
            </h3>
            {goal.childGoals && goal.childGoals.length > 0 && (
              <div className="space-y-1">
                {goal.childGoals.map((child) => (
                  <div
                    key={child.id}
                    className="flex items-center gap-2 rounded px-2 py-1 text-sm text-zinc-400 hover:bg-white/[0.03] transition"
                  >
                    <ProgressRing
                      percent={getProgressFields(child).progressPercent}
                      health={child.health}
                      size={14}
                      strokeWidth={2}
                    />
                    <StatusDot status={child.status} className="h-1.5 w-1.5" />
                    <span className="min-w-0 flex-1 truncate">{child.title}</span>
                  </div>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const input = e.currentTarget.querySelector('input')
                const title = input?.value.trim()
                if (!title) return
                panelCreateSubGoalMutation.mutate(
                  { title, outcome: 'TBD', parentGoalId: goalId },
                  {
                    onSuccess: () => {
                      if (input) input.value = ''
                    },
                  }
                )
              }}
              className="mt-1 flex items-center gap-2 px-2"
            >
              <input
                placeholder="Add sub-goal..."
                className="h-6 flex-1 border-0 bg-transparent text-xs text-zinc-400 placeholder:text-zinc-600 outline-none"
              />
            </form>
          </div>

          {/* Updates timeline (compact) */}
          {goal.updates && goal.updates.length > 0 && (
            <div>
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-2">
                Updates
              </h3>
              <div className="space-y-2">
                {goal.updates.slice(0, 5).map((update, i) => (
                  <div key={i} className="text-xs">
                    <span className="text-zinc-600">
                      <RelativeTime timestamp={update.created_at} />
                    </span>
                    <p className="mt-0.5 text-zinc-400 line-clamp-2">{update.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create Goal Dialog
// ---------------------------------------------------------------------------

function CreateGoalDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const utils = trpc.useUtils()
  const [title, setTitle] = useState('')
  const [outcome, setOutcome] = useState('')
  const [parentGoalId, setParentGoalId] = useState<string | null>(null)
  const [ownerKind, setOwnerKind] = useState<ActorKind | ''>('')
  const [ownerRef, setOwnerRef] = useState<string | null>(null)
  const [progressSource, setProgressSource] = useState('ticket_rollup')
  const [progressTarget, setProgressTarget] = useState('')
  const [progressUnit, setProgressUnit] = useState('')

  const goalsForParentQuery = trpc.work.listGoals.useQuery({
    limit: 200,
    includeArchived: false,
    sort: { field: 'title', direction: 'asc' },
  })
  const membersQuery = trpc.org.listMembers.useQuery()
  const agentsQuery = trpc.org.listAgents.useQuery()

  const parentGoalItems = useMemo(
    () => (goalsForParentQuery.data ?? []).map((g) => ({ value: g.id, label: g.title })),
    [goalsForParentQuery.data]
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

  const ownerRefItems = useMemo(() => {
    if (ownerKind === 'user') return userOptions
    if (ownerKind === 'agent') return agentOptions
    return []
  }, [ownerKind, userOptions, agentOptions])

  const createGoalMutation = trpc.work.createGoal.useMutation({
    onSuccess: async () => {
      setTitle('')
      setOutcome('')
      setParentGoalId(null)
      setOwnerKind('')
      setOwnerRef(null)
      setProgressSource('ticket_rollup')
      setProgressTarget('')
      setProgressUnit('')
      onOpenChange(false)
      await Promise.all([utils.work.listGoals.invalidate()])
    },
    onError: () => {
      toast.error('Failed to create goal')
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Goal</DialogTitle>
          <DialogDescription>Define a goal to organize work around.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Goal title"
          />
          <Textarea
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="Desired outcome (optional)"
            rows={2}
          />
          <Combobox value={parentGoalId ?? ''} onValueChange={(v) => setParentGoalId(v || null)}>
            <ComboboxInput placeholder="No parent goal" showClear={!!parentGoalId} />
            <ComboboxContent>
              <ComboboxList>
                {parentGoalItems.map((item) => (
                  <ComboboxItem key={item.value} value={item.value}>
                    {item.label}
                  </ComboboxItem>
                ))}
                <ComboboxEmpty>No goals found</ComboboxEmpty>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <div className="grid gap-2 sm:grid-cols-2">
            <NativeSelect
              value={ownerKind}
              onChange={(e) => {
                setOwnerKind(e.target.value as ActorKind | '')
                setOwnerRef(null)
              }}
              className="w-full"
            >
              <NativeSelectOption value="">No owner</NativeSelectOption>
              <NativeSelectOption value="user">User</NativeSelectOption>
              <NativeSelectOption value="agent">Agent</NativeSelectOption>
            </NativeSelect>
            {ownerKind ? (
              <Combobox value={ownerRef ?? ''} onValueChange={(v) => setOwnerRef(v || null)}>
                <ComboboxInput placeholder="Select owner" showClear={!!ownerRef} />
                <ComboboxContent>
                  <ComboboxList>
                    {ownerRefItems.map((item) => (
                      <ComboboxItem key={item.value} value={item.value}>
                        {item.label}
                      </ComboboxItem>
                    ))}
                    <ComboboxEmpty>No matches</ComboboxEmpty>
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            ) : null}
          </div>

          {/* Progress tracking */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              Progress tracking
            </label>
            <NativeSelect
              value={progressSource}
              onChange={(e) => {
                setProgressSource(e.target.value)
                setProgressTarget('')
                setProgressUnit('')
              }}
              className="w-full"
            >
              <NativeSelectOption value="ticket_rollup">Ticket rollup</NativeSelectOption>
              <NativeSelectOption value="sub_goal_rollup">Sub-goal rollup</NativeSelectOption>
              <NativeSelectOption value="number">Number</NativeSelectOption>
              <NativeSelectOption value="currency">Currency</NativeSelectOption>
              <NativeSelectOption value="percentage">Percentage</NativeSelectOption>
              <NativeSelectOption value="boolean">Boolean (done/not done)</NativeSelectOption>
            </NativeSelect>
            {(progressSource === 'number' || progressSource === 'currency') && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  type="number"
                  value={progressTarget}
                  onChange={(e) => setProgressTarget(e.target.value)}
                  placeholder={progressSource === 'currency' ? 'Target amount' : 'Target value'}
                />
                <Input
                  value={progressUnit}
                  onChange={(e) => setProgressUnit(e.target.value)}
                  placeholder={progressSource === 'currency' ? 'e.g. USD' : 'e.g. engineers'}
                />
              </div>
            )}
          </div>
        </div>
        <DialogFooter showCloseButton>
          <Button
            onClick={() => {
              const input = {
                title,
                outcome: outcome || 'TBD',
                parentGoalId: parentGoalId || null,
                ownerKind: ownerKind || null,
                ownerRef: ownerRef || null,
                progressSource: progressSource || undefined,
                progressTarget: progressTarget ? Number(progressTarget) : undefined,
                progressUnit: progressUnit || undefined,
              }
              // Progress fields may not exist on the mutation input type yet
              // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
              createGoalMutation.mutate(input as any)
            }}
            disabled={!title.trim() || createGoalMutation.isPending}
          >
            Create Goal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GoalsClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const utils = trpc.useUtils()

  // Query params for cross-surface linking
  const ownerParam = searchParams.get('owner')
  const teamIdParam = searchParams.get('teamId')

  const { selectedId, setSelectedId, clearSelection } = useTreeSelection()
  const isDesktop = useIsDesktop()

  // On mobile, clicking a row navigates to the detail page instead of opening the side panel
  const handleSelect = useCallback(
    (id: string) => {
      if (isDesktop) {
        setSelectedId(id)
      } else {
        router.push(`/goals/${id}`)
      }
    },
    [isDesktop, setSelectedId, router]
  )

  const [activeViewId, setActiveViewId] = useState('active')
  const [search, setSearch] = useState('')
  const [filterStatuses, setFilterStatuses] = useState<string[]>([])
  const [filterOwner, setFilterOwner] = useState<string>(ownerParam ?? '')
  const [filterTeam, setFilterTeam] = useState<string>(teamIdParam ?? '')
  const [createGoalOpen, setCreateGoalOpen] = useState(false)
  const [creatingChildOf, setCreatingChildOf] = useState<string | null>(null)

  const activeView = GOAL_VIEWS.find((v) => v.id === activeViewId) ?? GOAL_VIEWS[0]!

  const goalFilters = useMemo<GoalListInput>(() => {
    const base = activeView.filters
    return {
      ...base,
      q: search || undefined,
      statuses: filterStatuses.length > 0 ? filterStatuses.filter(isGoalStatus) : base.statuses,
      ownerRef: filterOwner || undefined,
      teamId: filterTeam || undefined,
    }
  }, [activeView, search, filterStatuses, filterOwner, filterTeam])

  const goalsQuery = trpc.work.listGoals.useQuery(goalFilters)
  const goals = useMemo(() => goalsQuery.data ?? [], [goalsQuery.data])

  const goalTree = useMemo(() => buildGoalTree(goals), [goals])
  const flatGoals = useMemo(() => flattenGoalTree(goalTree), [goalTree])
  const descendantGoalMap = useMemo(() => buildDescendantGoalMap(goalTree), [goalTree])

  const rootGoalIds = useMemo(() => goalTree.map((n) => n.goal.id), [goalTree])
  useAutoSelectFirst(rootGoalIds[0], selectedId, setSelectedId)

  const {
    expandedIds,
    toggle: handleToggle,
    setExpandedIds,
  } = useTreeExpand({
    autoExpandIds: rootGoalIds,
  })

  const updateGoalMutation = trpc.work.updateGoal.useMutation({
    onSuccess: async () => {
      await utils.work.listGoals.invalidate()
    },
    onError: () => {
      toast.error('Failed to update goal')
    },
  })

  const inlineCreateGoalMutation = trpc.work.createGoal.useMutation({
    onSuccess: async () => {
      await utils.work.listGoals.invalidate()
    },
    onError: () => {
      toast.error('Failed to create goal')
    },
  })

  const inlineCreateSubGoalMutation = trpc.work.createGoal.useMutation({
    onSuccess: async () => {
      await utils.work.listGoals.invalidate()
    },
    onError: () => {
      toast.error('Failed to create sub-goal')
    },
  })

  const handleStatusChange = useCallback(
    (goalId: string, status: string) => {
      updateGoalMutation.mutate({ goalId, patch: { status: status as GoalStatus } })
    },
    [updateGoalMutation]
  )

  const handleArchive = useCallback(
    (goalId: string) => {
      updateGoalMutation.mutate({ goalId, patch: { status: 'archived' as GoalStatus } })
    },
    [updateGoalMutation]
  )

  const handleInlineGoalCreate = useCallback(
    (title: string) => {
      inlineCreateGoalMutation.mutate({ title, outcome: 'TBD' })
    },
    [inlineCreateGoalMutation]
  )

  const handleInlineSubGoalCreate = useCallback(
    (title: string, parentGoalId: string) => {
      inlineCreateSubGoalMutation.mutate({ title, outcome: 'TBD', parentGoalId })
    },
    [inlineCreateSubGoalMutation]
  )

  const reorderGoalMutation = trpc.work.reorderGoal.useMutation({
    onMutate: async ({ goalId, newParentGoalId, sortOrder }) => {
      await utils.work.listGoals.cancel()
      const previous = utils.work.listGoals.getData(goalFilters)
      if (previous) {
        utils.work.listGoals.setData(
          goalFilters,
          applyOptimisticReorder(
            previous,
            goalId,
            newParentGoalId,
            sortOrder,
            (g) => g.id,
            (g) => g.parentGoalId,
            (g) => g.sortOrder,
            (g, pid) => ({ ...g, parentGoalId: pid }),
            (g, so) => ({ ...g, sortOrder: so })
          )
        )
      }
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        utils.work.listGoals.setData(goalFilters, ctx.previous)
      }
      toast.error('Failed to reorder goal')
    },
    onSettled: () => {
      void utils.work.listGoals.invalidate()
    },
  })

  const handleGoalDrop = useCallback(
    (draggedGoalId: string, parentGoalId: string | null, sortOrder: number | null) => {
      if (parentGoalId) {
        setExpandedIds((current) => new Set(current).add(parentGoalId))
      }
      reorderGoalMutation.mutate({
        goalId: draggedGoalId,
        newParentGoalId: parentGoalId,
        sortOrder: sortOrder ?? 0,
      })
    },
    [setExpandedIds, reorderGoalMutation]
  )

  const getSiblingOrder = useCallback(
    (parentId: string | null) => {
      const toEntry = (n: GoalTreeNode) => ({ id: n.goal.id, sortOrder: n.goal.sortOrder })
      if (parentId === null) {
        return goalTree.map(toEntry)
      }
      const findNode = (nodes: GoalTreeNode[]): GoalTreeNode | undefined => {
        for (const node of nodes) {
          if (node.goal.id === parentId) return node
          const found = findNode(node.children)
          if (found) return found
        }
        return undefined
      }
      const parent = findNode(goalTree)
      return parent ? parent.children.map(toEntry) : []
    },
    [goalTree]
  )

  const getParentId = useCallback(
    (goalId: string): string | null => {
      const goal = goals.find((g) => g.id === goalId)
      return goal?.parentGoalId ?? null
    },
    [goals]
  )

  const {
    draggedId,
    dragTargetId,
    dropPosition,
    rootDropOver,
    startDrag,
    endDrag,
    getRowDragHandlers,
    getGroupEndDropHandlers,
    getRootDropHandlers,
  } = useTreeDragDrop({
    descendantMap: descendantGoalMap,
    onDrop: handleGoalDrop,
    toastErrorMessage: 'A goal cannot be moved under one of its own children',
    getSiblingOrder,
    getParentId,
    isExpandedWithChildren: (id: string) => {
      const hasKids = (descendantGoalMap.get(id)?.size ?? 0) > 0
      return hasKids && expandedIds.has(id)
    },
  })

  const { editingId, startEdit, cancelEdit, commitEdit } = useTreeInlineEdit({
    onCommit: (goalId, title) => {
      updateGoalMutation.mutate({ goalId, patch: { title } })
    },
  })

  const flatIds = useMemo(() => flatGoals.map((g) => g.id), [flatGoals])

  useTreeKeyboardNav({
    flatIds,
    selectedId,
    onSelect: handleSelect,
    onClear: clearSelection,
    onStartEdit: startEdit,
    onOpen: (id) => router.push(`/goals/${id}`),
    onCreate: () => setCreateGoalOpen(true),
  })

  function clearUrlParams() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('owner')
    params.delete('teamId')
    const newUrl = params.toString() ? `?${params.toString()}` : '/goals'
    router.replace(newUrl)
  }

  function applyView(viewId: string) {
    setActiveViewId(viewId)
    setSearch('')
    setFilterStatuses([])
    setFilterOwner('')
    setFilterTeam('')
    clearSelection()
    if (ownerParam || teamIdParam) clearUrlParams()
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  function renderTree() {
    if (goalTree.length === 0) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
          <Target className="h-8 w-8 text-zinc-700" />
          <p className="text-sm text-zinc-500">No goals here yet. Press c to set one.</p>
          <p className="text-xs text-zinc-600">
            Press{' '}
            <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1 py-0.5 font-mono text-[10px] text-zinc-500">
              c
            </kbd>{' '}
            to create a goal.
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
        {goalTree.map((node) => (
          <GoalTreeRow
            key={node.goal.id}
            node={node}
            depth={0}
            selectedId={selectedId}
            expandedIds={expandedIds}
            onToggle={handleToggle}
            onSelect={handleSelect}
            onStatusChange={handleStatusChange}
            onArchive={handleArchive}
            onInlineSubGoalCreate={handleInlineSubGoalCreate}
            inlineSubGoalPending={inlineCreateSubGoalMutation.isPending}
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
        ))}

        {/* Inline goal creation at bottom */}
        <InlineCreateRow
          placeholder="New goal..."
          isPending={inlineCreateGoalMutation.isPending}
          onSubmit={handleInlineGoalCreate}
        />
      </div>
    )
  }

  const toolbarAndBreadcrumb = (
    <>
      <TreeToolbar
        title="Goals"
        views={GOAL_VIEWS}
        activeViewId={activeViewId}
        onViewChange={applyView}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search goals..."
        onCreateClick={() => setCreateGoalOpen(true)}
      />
    </>
  )

  return (
    <div className="flex h-full flex-col">
      <TreeDetailLayout
        header={toolbarAndBreadcrumb}
        tree={goalsQuery.isLoading ? <SkeletonTreeRows /> : renderTree()}
        detail={
          selectedId ? <GoalDetailPanel goalId={selectedId} onClose={clearSelection} /> : null
        }
      />

      {/* Dialogs */}
      <CreateGoalDialog open={createGoalOpen} onOpenChange={setCreateGoalOpen} />
    </div>
  )
}
