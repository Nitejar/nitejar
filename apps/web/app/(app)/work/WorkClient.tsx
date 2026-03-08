'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  IconAlertTriangle,
  IconArrowRight,
  IconClock,
  IconDeviceFloppy,
  IconHierarchy,
  IconLink,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSparkles,
  IconTargetArrow,
  IconTrash,
} from '@tabler/icons-react'
import { trpc, type RouterOutputs } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { RelativeTime } from '../components/RelativeTime'

type GoalRow = RouterOutputs['work']['listGoals'][number]
type TicketRow = RouterOutputs['work']['listTickets'][number]
type SuggestedTicket = RouterOutputs['work']['suggestRelated'][number]
type ActorKind = 'user' | 'agent' | 'team'
type GoalStatus = 'draft' | 'active' | 'at_risk' | 'blocked' | 'done' | 'archived'
type TicketStatus = 'inbox' | 'ready' | 'in_progress' | 'blocked' | 'done' | 'canceled'
type GoalSortField = 'updated_at' | 'created_at' | 'title' | 'status'
type TicketSortField = 'updated_at' | 'created_at' | 'title' | 'status'
type SortDirection = 'asc' | 'desc'
type TicketScope = 'mine' | 'my_team' | 'unclaimed' | 'all'
type GoalListInput = {
  statuses?: GoalStatus[]
  q?: string
  ownerKind?: ActorKind
  ownerRef?: string
  teamId?: string
  initiativeId?: string
  staleOnly?: boolean
  includeArchived?: boolean
  limit?: number
  sort?: {
    field: GoalSortField
    direction: SortDirection
  }
}
type TicketListInput = {
  scope?: TicketScope
  statuses?: TicketStatus[]
  q?: string
  goalId?: string | null
  assigneeKind?: ActorKind
  assigneeRef?: string
  staleOnly?: boolean
  includeArchived?: boolean
  limit?: number
  sort?: {
    field: TicketSortField
    direction: SortDirection
  }
}
type WorkTab = 'overview' | 'goals' | 'tickets' | 'untracked'
type SaveEntityKind = 'goal' | 'ticket'
type GoalGroupBy = 'status' | 'owner' | 'team' | 'health'

type BuiltInView<TFilters> = {
  id: string
  name: string
  description: string
  filters: TFilters
}

const DEFAULT_GOAL_FILTERS: GoalListInput = {
  includeArchived: false,
  staleOnly: false,
  limit: 100,
  sort: {
    field: 'updated_at',
    direction: 'desc',
  },
}

const DEFAULT_TICKET_FILTERS: TicketListInput = {
  scope: 'all',
  includeArchived: false,
  staleOnly: false,
  limit: 100,
  sort: {
    field: 'updated_at',
    direction: 'desc',
  },
}

const BUILT_IN_GOAL_VIEWS: BuiltInView<GoalListInput>[] = [
  {
    id: 'builtin:goal:active',
    name: 'Active',
    description: 'Active, at-risk, and blocked goals',
    filters: {
      ...DEFAULT_GOAL_FILTERS,
      statuses: ['active', 'at_risk', 'blocked'],
    },
  },
  {
    id: 'builtin:goal:attention',
    name: 'Attention',
    description: 'At-risk and blocked goals',
    filters: {
      ...DEFAULT_GOAL_FILTERS,
      statuses: ['at_risk', 'blocked'],
    },
  },
  {
    id: 'builtin:goal:done',
    name: 'Done',
    description: 'Completed goals',
    filters: {
      ...DEFAULT_GOAL_FILTERS,
      statuses: ['done'],
    },
  },
  {
    id: 'builtin:goal:stale',
    name: 'Stale',
    description: 'Goals that have gone quiet or missed heartbeats',
    filters: {
      ...DEFAULT_GOAL_FILTERS,
      statuses: ['active', 'at_risk', 'blocked'],
      staleOnly: true,
    },
  },
  {
    id: 'builtin:goal:all',
    name: 'All',
    description: 'Every non-archived goal',
    filters: {
      ...DEFAULT_GOAL_FILTERS,
    },
  },
]

const BUILT_IN_TICKET_VIEWS: BuiltInView<TicketListInput>[] = [
  {
    id: 'builtin:ticket:mine',
    name: 'Mine',
    description: 'My active tickets',
    filters: {
      ...DEFAULT_TICKET_FILTERS,
      scope: 'mine',
      statuses: ['ready', 'in_progress', 'blocked'],
    },
  },
  {
    id: 'builtin:ticket:my-team',
    name: 'My Team',
    description: 'Team queue across inbox and active work',
    filters: {
      ...DEFAULT_TICKET_FILTERS,
      scope: 'my_team',
      statuses: ['inbox', 'ready', 'in_progress', 'blocked'],
    },
  },
  {
    id: 'builtin:ticket:blocked',
    name: 'Blocked',
    description: 'Blocked tickets across the organization',
    filters: {
      ...DEFAULT_TICKET_FILTERS,
      scope: 'all',
      statuses: ['blocked'],
    },
  },
  {
    id: 'builtin:ticket:stale',
    name: 'Stale',
    description: 'Active tickets that have gone quiet',
    filters: {
      ...DEFAULT_TICKET_FILTERS,
      scope: 'all',
      statuses: ['ready', 'in_progress', 'blocked'],
      staleOnly: true,
    },
  },
  {
    id: 'builtin:ticket:unclaimed',
    name: 'Unclaimed',
    description: 'Tickets waiting for a specific owner',
    filters: {
      ...DEFAULT_TICKET_FILTERS,
      scope: 'unclaimed',
      statuses: ['inbox', 'ready', 'in_progress', 'blocked'],
    },
  },
  {
    id: 'builtin:ticket:all',
    name: 'All',
    description: 'Every non-archived ticket',
    filters: {
      ...DEFAULT_TICKET_FILTERS,
      scope: 'all',
      statuses: ['inbox', 'ready', 'in_progress', 'blocked'],
    },
  },
]

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'blocked' || status === 'at_risk') return 'destructive'
  if (status === 'done') return 'secondary'
  if (status === 'in_progress' || status === 'active') return 'default'
  return 'outline'
}

function isGoalStatus(value: unknown): value is GoalStatus {
  return (
    value === 'draft' ||
    value === 'active' ||
    value === 'at_risk' ||
    value === 'blocked' ||
    value === 'done' ||
    value === 'archived'
  )
}

function isTicketStatus(value: unknown): value is TicketStatus {
  return (
    value === 'inbox' ||
    value === 'ready' ||
    value === 'in_progress' ||
    value === 'blocked' ||
    value === 'done' ||
    value === 'canceled'
  )
}

function sameStringSet(values: string[] | undefined, expected: string[]): boolean {
  if (!values || values.length !== expected.length) return false
  const actual = [...values].sort()
  const target = [...expected].sort()
  return actual.every((value, index) => value === target[index])
}

function normalizeGoalFilters(input: unknown): GoalListInput {
  const candidate =
    input && typeof input === 'object'
      ? (input as Partial<GoalListInput>)
      : ({} as Partial<GoalListInput>)

  return {
    q: typeof candidate.q === 'string' && candidate.q.trim() ? candidate.q.trim() : undefined,
    statuses: Array.isArray(candidate.statuses)
      ? candidate.statuses.filter(isGoalStatus)
      : undefined,
    ownerKind:
      candidate.ownerKind === 'user' ||
      candidate.ownerKind === 'agent' ||
      candidate.ownerKind === 'team'
        ? candidate.ownerKind
        : undefined,
    ownerRef:
      typeof candidate.ownerRef === 'string' && candidate.ownerRef.trim()
        ? candidate.ownerRef.trim()
        : undefined,
    teamId:
      typeof candidate.teamId === 'string' && candidate.teamId.trim()
        ? candidate.teamId.trim()
        : undefined,
    initiativeId:
      typeof candidate.initiativeId === 'string' && candidate.initiativeId.trim()
        ? candidate.initiativeId.trim()
        : undefined,
    staleOnly: candidate.staleOnly === true,
    includeArchived: candidate.includeArchived === true,
    limit:
      typeof candidate.limit === 'number'
        ? Math.min(Math.max(Math.trunc(candidate.limit), 1), 200)
        : DEFAULT_GOAL_FILTERS.limit,
    sort: {
      field:
        candidate.sort?.field === 'created_at' ||
        candidate.sort?.field === 'title' ||
        candidate.sort?.field === 'status'
          ? candidate.sort.field
          : 'updated_at',
      direction: candidate.sort?.direction === 'asc' ? 'asc' : 'desc',
    },
  }
}

function normalizeTicketFilters(input: unknown): TicketListInput {
  const candidate =
    input && typeof input === 'object'
      ? (input as Partial<TicketListInput>)
      : ({} as Partial<TicketListInput>)

  const scope: TicketScope =
    candidate.scope === 'mine' ||
    candidate.scope === 'my_team' ||
    candidate.scope === 'unclaimed' ||
    candidate.scope === 'all'
      ? candidate.scope
      : 'all'

  return {
    scope,
    q: typeof candidate.q === 'string' && candidate.q.trim() ? candidate.q.trim() : undefined,
    statuses: Array.isArray(candidate.statuses)
      ? candidate.statuses.filter(isTicketStatus)
      : undefined,
    goalId:
      candidate.goalId === null
        ? null
        : typeof candidate.goalId === 'string' && candidate.goalId.trim()
          ? candidate.goalId.trim()
          : undefined,
    assigneeKind:
      candidate.assigneeKind === 'user' ||
      candidate.assigneeKind === 'agent' ||
      candidate.assigneeKind === 'team'
        ? candidate.assigneeKind
        : undefined,
    assigneeRef:
      typeof candidate.assigneeRef === 'string' && candidate.assigneeRef.trim()
        ? candidate.assigneeRef.trim()
        : undefined,
    staleOnly: candidate.staleOnly === true,
    includeArchived: candidate.includeArchived === true,
    limit:
      typeof candidate.limit === 'number'
        ? Math.min(Math.max(Math.trunc(candidate.limit), 1), 200)
        : DEFAULT_TICKET_FILTERS.limit,
    sort: {
      field:
        candidate.sort?.field === 'created_at' ||
        candidate.sort?.field === 'title' ||
        candidate.sort?.field === 'status'
          ? candidate.sort.field
          : 'updated_at',
      direction: candidate.sort?.direction === 'asc' ? 'asc' : 'desc',
    },
  }
}

function goalStatusPresetValue(filters: GoalListInput): string {
  if (filters.staleOnly) return 'stale'
  if (!filters.statuses || filters.statuses.length === 0) return 'all'
  if (sameStringSet(filters.statuses, ['active', 'at_risk', 'blocked'])) return 'active'
  if (sameStringSet(filters.statuses, ['at_risk', 'blocked'])) return 'attention'
  if (sameStringSet(filters.statuses, ['done'])) return 'done'
  if (sameStringSet(filters.statuses, ['draft'])) return 'draft'
  return 'custom'
}

function ticketStatusPresetValue(filters: TicketListInput): string {
  if (!filters.statuses || filters.statuses.length === 0) return 'all'
  if (sameStringSet(filters.statuses, ['inbox', 'ready', 'in_progress', 'blocked'])) return 'open'
  if (sameStringSet(filters.statuses, ['ready', 'in_progress', 'blocked'])) return 'active'
  if (sameStringSet(filters.statuses, ['blocked'])) return 'blocked'
  if (sameStringSet(filters.statuses, ['in_progress'])) return 'in_progress'
  if (sameStringSet(filters.statuses, ['done'])) return 'done'
  if (sameStringSet(filters.statuses, ['inbox'])) return 'inbox'
  return 'custom'
}

function goalStatusesFromPreset(value: string): GoalStatus[] | undefined {
  if (value === 'stale') return ['active', 'at_risk', 'blocked']
  if (value === 'active') return ['active', 'at_risk', 'blocked']
  if (value === 'attention') return ['at_risk', 'blocked']
  if (value === 'done') return ['done']
  if (value === 'draft') return ['draft']
  return undefined
}

function ticketStatusesFromPreset(value: string): TicketStatus[] | undefined {
  if (value === 'open') return ['inbox', 'ready', 'in_progress', 'blocked']
  if (value === 'active') return ['ready', 'in_progress', 'blocked']
  if (value === 'blocked') return ['blocked']
  if (value === 'in_progress') return ['in_progress']
  if (value === 'done') return ['done']
  if (value === 'inbox') return ['inbox']
  return undefined
}

function applyGoalPreset(preset: BuiltInView<GoalListInput>): GoalListInput {
  return normalizeGoalFilters(preset.filters)
}

function applyTicketPreset(preset: BuiltInView<TicketListInput>): TicketListInput {
  return normalizeTicketFilters(preset.filters)
}

function WorkStatusBadge({ status }: { status: string }) {
  return <Badge variant={statusBadgeVariant(status)}>{status.replace(/_/g, ' ')}</Badge>
}

function GoalHealthBadge({ goal }: { goal: GoalRow }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant={statusBadgeVariant(goal.health)}>{goal.health.replace(/_/g, ' ')}</Badge>
      {goal.isStale ? <Badge variant="outline">stale</Badge> : null}
    </div>
  )
}

function ActorLabel({
  actor,
}: {
  actor:
    | {
        label: string
        kind: string
        handle?: string | null
        title?: string | null
      }
    | null
    | undefined
}) {
  if (!actor) {
    return <span className="text-muted-foreground">Unassigned</span>
  }

  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <span>{actor.label}</span>
      {actor.kind === 'agent' && actor.handle ? (
        <span className="font-mono text-xs text-muted-foreground">@{actor.handle}</span>
      ) : null}
    </span>
  )
}

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: number | string
  icon: typeof IconTargetArrow
}) {
  return (
    <div className="flex items-start justify-between gap-3 bg-white/[0.03] px-4 py-4">
      <div>
        <p className="text-[0.6rem] uppercase tracking-[0.25em] text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      </div>
      <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
    </div>
  )
}

function SectionList({
  title,
  items,
  empty,
}: {
  title: string
  items: ReactNode[]
  empty: string
}) {
  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length > 0 ? items : <p className="text-sm text-muted-foreground">{empty}</p>}
      </CardContent>
    </Card>
  )
}

function ViewChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.18em] transition',
        active
          ? 'border-white/25 bg-white/10 text-white'
          : 'border-white/10 bg-white/[0.02] text-muted-foreground hover:border-white/20 hover:bg-white/[0.04] hover:text-white'
      )}
    >
      {label}
    </button>
  )
}

function goalGroupLabel(goal: GoalRow, groupBy: GoalGroupBy) {
  if (groupBy === 'owner') return goal.owner?.label ?? 'No owner'
  if (groupBy === 'team') return goal.owner?.kind === 'team' ? goal.owner.label : 'No team owner'
  if (groupBy === 'health') return goal.health.replace(/_/g, ' ')
  return goal.status.replace(/_/g, ' ')
}

function GoalTable({ goals, groupBy }: { goals: GoalRow[]; groupBy: GoalGroupBy | null }) {
  if (goals.length === 0) {
    return (
      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="py-10 text-sm text-muted-foreground">
          No goals match this view.
        </CardContent>
      </Card>
    )
  }

  const groups = groupBy
    ? goals.reduce((acc, goal) => {
        const label = goalGroupLabel(goal, groupBy)
        const current = acc.get(label) ?? []
        current.push(goal)
        acc.set(label, current)
        return acc
      }, new Map<string, GoalRow[]>())
    : new Map<string, GoalRow[]>([['All goals', goals]])

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([label, groupedGoals]) => (
        <Card key={label} className="border-white/10 bg-white/[0.02]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {label}
              {groupBy ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {groupedGoals.length}
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10">
                  <TableHead className="pl-4 text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Goal
                  </TableHead>
                  <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Initiative
                  </TableHead>
                  <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Health
                  </TableHead>
                  <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Owner
                  </TableHead>
                  <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Structure
                  </TableHead>
                  <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Heartbeat
                  </TableHead>
                  <TableHead className="pr-4 text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Latest Update
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedGoals.map((goal) => {
                  const openTickets = goal.ticketCounts.total - goal.ticketCounts.done
                  return (
                    <TableRow key={goal.id} className="border-white/10">
                      <TableCell className="w-[30%] max-w-0 pl-4 align-top whitespace-normal">
                        <div className="space-y-1">
                          <Link
                            href={`/work/goals/${goal.id}`}
                            className="font-medium text-white hover:underline"
                          >
                            {goal.title}
                          </Link>
                          {goal.parentGoal ? (
                            <div className="text-xs text-muted-foreground">
                              Child of {goal.parentGoal.title}
                            </div>
                          ) : null}
                          <p className="line-clamp-2 text-sm text-muted-foreground">
                            {goal.outcome}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="align-top whitespace-normal text-sm text-muted-foreground">
                        {goal.initiative ? (
                          <div className="space-y-1">
                            <div className="text-white">{goal.initiative.title}</div>
                            <div>{goal.initiative.targetLabel ?? 'No target set'}</div>
                          </div>
                        ) : (
                          <span>No initiative</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <GoalHealthBadge goal={goal} />
                      </TableCell>
                      <TableCell className="align-top whitespace-normal">
                        <ActorLabel actor={goal.owner} />
                      </TableCell>
                      <TableCell className="align-top whitespace-normal text-sm text-muted-foreground">
                        <div>
                          {openTickets} open / {goal.ticketCounts.total} total
                        </div>
                        <div>{goal.childGoalCount} child goals</div>
                      </TableCell>
                      <TableCell className="align-top whitespace-normal text-xs text-muted-foreground">
                        {goal.lastHeartbeatAt ? (
                          <RelativeTime timestamp={goal.lastHeartbeatAt} />
                        ) : (
                          'No heartbeat yet'
                        )}
                      </TableCell>
                      <TableCell className="max-w-[320px] pr-4 align-top whitespace-normal">
                        {goal.latestUpdate ? (
                          <div className="space-y-1">
                            <div className="line-clamp-2 text-sm text-white">
                              {goal.latestUpdate.body}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              <RelativeTime timestamp={goal.latestUpdate.createdAt} />
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            Updated <RelativeTime timestamp={goal.lastActivityAt} />
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function TicketTable({
  tickets,
  selectedTicketIds,
  onToggleTicket,
  onToggleAllTickets,
}: {
  tickets: TicketRow[]
  selectedTicketIds: string[]
  onToggleTicket: (ticketId: string, checked: boolean) => void
  onToggleAllTickets: (checked: boolean) => void
}) {
  if (tickets.length === 0) {
    return (
      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="py-10 text-sm text-muted-foreground">
          No tickets match this view.
        </CardContent>
      </Card>
    )
  }

  const selectedSet = new Set(selectedTicketIds)
  const allSelected = tickets.length > 0 && tickets.every((ticket) => selectedSet.has(ticket.id))

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10">
              <TableHead className="w-10 pl-4">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) => onToggleAllTickets(checked === true)}
                />
              </TableHead>
              <TableHead className="pl-4 text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                Ticket
              </TableHead>
              <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                Goal
              </TableHead>
              <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                Hierarchy
              </TableHead>
              <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                Status
              </TableHead>
              <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                Assignee
              </TableHead>
              <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                Receipts
              </TableHead>
              <TableHead className="pr-4 text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                Latest Update
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tickets.map((ticket) => (
              <TableRow
                key={ticket.id}
                className={cn(
                  'border-white/10',
                  selectedSet.has(ticket.id) ? 'bg-white/[0.03]' : undefined
                )}
              >
                <TableCell className="pl-4 align-top">
                  <Checkbox
                    checked={selectedSet.has(ticket.id)}
                    onCheckedChange={(checked) => onToggleTicket(ticket.id, checked === true)}
                  />
                </TableCell>
                <TableCell className="w-[30%] max-w-0 pl-4 align-top whitespace-normal">
                  <div className="space-y-1">
                    <Link
                      href={`/work/tickets/${ticket.id}`}
                      className="font-medium text-white hover:underline"
                    >
                      {ticket.title}
                    </Link>
                    {ticket.parentTicket ? (
                      <div className="text-xs text-muted-foreground">
                        Sub-ticket of {ticket.parentTicket.title}
                      </div>
                    ) : null}
                    {ticket.body ? (
                      <p className="line-clamp-2 text-sm text-muted-foreground">{ticket.body}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">No body yet.</p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  {ticket.goal ? (
                    <div className="space-y-1">
                      <Link
                        href={`/work/goals/${ticket.goal.id}`}
                        className="inline-flex items-center gap-1 text-sm text-white hover:underline"
                      >
                        <IconHierarchy className="h-3.5 w-3.5 text-muted-foreground" />
                        {ticket.goal.title}
                      </Link>
                      {ticket.goal.initiative ? (
                        <div className="text-xs text-muted-foreground">
                          {ticket.goal.initiative.title}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">No goal</span>
                  )}
                </TableCell>
                <TableCell className="align-top whitespace-normal text-sm text-muted-foreground">
                  <div>{ticket.childTicketCount} child tickets</div>
                  <div>{ticket.blockedByCount} blockers</div>
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <div className="flex flex-wrap gap-2">
                    <WorkStatusBadge status={ticket.status} />
                    {ticket.blockingCount > 0 ? <Badge variant="outline">blocking</Badge> : null}
                    {ticket.isUnclaimed ? <Badge variant="outline">unclaimed</Badge> : null}
                  </div>
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <ActorLabel actor={ticket.assignee} />
                </TableCell>
                <TableCell className="align-top whitespace-normal text-sm text-muted-foreground">
                  <div>{ticket.links.length} linked receipts</div>
                  <div>
                    Updated <RelativeTime timestamp={ticket.updatedAt} />
                  </div>
                </TableCell>
                <TableCell className="max-w-[320px] pr-4 align-top whitespace-normal">
                  {ticket.latestUpdate ? (
                    <div className="space-y-1">
                      <div className="line-clamp-2 text-sm text-white">
                        {ticket.latestUpdate.body}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <RelativeTime timestamp={ticket.latestUpdate.createdAt} />
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">No updates yet.</div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function SuggestedTickets({ suggestions }: { suggestions: SuggestedTicket[] }) {
  if (suggestions.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-200">
        <IconSparkles className="h-4 w-4" />
        Related open tickets
      </div>
      <div className="space-y-2">
        {suggestions.map((ticket) => (
          <Link
            key={ticket.id}
            href={`/work/tickets/${ticket.id}`}
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition hover:bg-white/5"
          >
            <span className="truncate">{ticket.title}</span>
            <span className="ml-3 text-xs text-muted-foreground">score {ticket.score}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function WorkClient() {
  const utils = trpc.useUtils()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<WorkTab>('overview')
  const [goalTitle, setGoalTitle] = useState('')
  const [goalOutcome, setGoalOutcome] = useState('')
  const [goalInitiativeId, setGoalInitiativeId] = useState('')
  const [goalOwnerKind, setGoalOwnerKind] = useState<ActorKind | ''>('')
  const [goalOwnerRef, setGoalOwnerRef] = useState('')
  const [ticketTitle, setTicketTitle] = useState('')
  const [ticketBody, setTicketBody] = useState('')
  const [ticketStatus, setTicketStatus] = useState<'inbox' | 'ready'>('ready')
  const [ticketGoalId, setTicketGoalId] = useState('')
  const [ticketAssigneeKind, setTicketAssigneeKind] = useState<ActorKind | ''>('')
  const [ticketAssigneeRef, setTicketAssigneeRef] = useState('')
  const [goalFilters, setGoalFilters] = useState<GoalListInput>(() =>
    applyGoalPreset(BUILT_IN_GOAL_VIEWS[0]!)
  )
  const [goalGroupBy, setGoalGroupBy] = useState<GoalGroupBy | null>(null)
  const [ticketFilters, setTicketFilters] = useState<TicketListInput>(() =>
    applyTicketPreset(BUILT_IN_TICKET_VIEWS[0]!)
  )
  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([])
  const [bulkTicketStatus, setBulkTicketStatus] = useState<TicketStatus | ''>('')
  const [bulkAssigneeKind, setBulkAssigneeKind] = useState<ActorKind | ''>('')
  const [bulkAssigneeRef, setBulkAssigneeRef] = useState('')
  const [selectedGoalViewId, setSelectedGoalViewId] = useState<string | null>(
    BUILT_IN_GOAL_VIEWS[0]!.id
  )
  const [selectedTicketViewId, setSelectedTicketViewId] = useState<string | null>(
    BUILT_IN_TICKET_VIEWS[0]!.id
  )
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveEntityKind, setSaveEntityKind] = useState<SaveEntityKind>('ticket')
  const [saveViewName, setSaveViewName] = useState('')

  const dashboardQuery = trpc.work.getDashboard.useQuery(undefined, {
    refetchInterval: 30_000,
  })
  const goalsQuery = trpc.work.listGoals.useQuery(goalFilters)
  const initiativesQuery = trpc.work.listInitiatives.useQuery({
    includeArchived: false,
  })
  const goalOptionsQuery = trpc.work.listGoals.useQuery({
    limit: 200,
    includeArchived: false,
    sort: {
      field: 'title',
      direction: 'asc',
    },
  })
  const ticketsQuery = trpc.work.listTickets.useQuery(ticketFilters)
  const goalViewsQuery = trpc.work.listViews.useQuery({ entityKind: 'goal' })
  const ticketViewsQuery = trpc.work.listViews.useQuery({ entityKind: 'ticket' })
  const membersQuery = trpc.org.listMembers.useQuery()
  const agentsQuery = trpc.org.listAgents.useQuery()
  const teamsQuery = trpc.org.listTeams.useQuery()

  const suggestionText = `${ticketTitle}\n${ticketBody}`.trim()
  const suggestionQuery = trpc.work.suggestRelated.useQuery(
    { text: suggestionText },
    { enabled: suggestionText.length >= 8 }
  )

  const createGoalMutation = trpc.work.createGoal.useMutation({
    onSuccess: async (goal) => {
      setGoalTitle('')
      setGoalOutcome('')
      setGoalInitiativeId('')
      setGoalOwnerKind('')
      setGoalOwnerRef('')
      await Promise.all([utils.work.getDashboard.invalidate(), utils.work.listGoals.invalidate()])
      router.push(`/work/goals/${goal.id}`)
    },
  })

  const createTicketMutation = trpc.work.createTicket.useMutation({
    onSuccess: async ({ ticket }) => {
      setTicketTitle('')
      setTicketBody('')
      setTicketGoalId('')
      setTicketAssigneeKind('')
      setTicketAssigneeRef('')
      setTicketStatus('ready')
      await Promise.all([
        utils.work.getDashboard.invalidate(),
        utils.work.listTickets.invalidate(),
        utils.work.listGoals.invalidate(),
      ])
      router.push(`/work/tickets/${ticket.id}`)
    },
  })

  const promoteSessionMutation = trpc.work.promoteSession.useMutation({
    onSuccess: async ({ ticket }) => {
      await Promise.all([utils.work.getDashboard.invalidate(), utils.work.listTickets.invalidate()])
      router.push(`/work/tickets/${ticket.id}`)
    },
  })

  const upsertViewMutation = trpc.work.upsertView.useMutation({
    onSuccess: (view) => {
      if (view.entityKind === 'goal') {
        setSelectedGoalViewId(view.id)
      } else {
        setSelectedTicketViewId(view.id)
      }
      setSaveDialogOpen(false)
      void Promise.all([
        utils.work.listViews.invalidate(),
        utils.work.listGoals.invalidate(),
        utils.work.listTickets.invalidate(),
      ])
    },
  })

  const deleteViewMutation = trpc.work.deleteView.useMutation({
    onSuccess: async () => {
      await utils.work.listViews.invalidate()
    },
  })
  const bulkUpdateTicketsMutation = trpc.work.bulkUpdateTickets.useMutation({
    onSuccess: async () => {
      setSelectedTicketIds([])
      setBulkTicketStatus('')
      setBulkAssigneeKind('')
      setBulkAssigneeRef('')
      await Promise.all([
        utils.work.getDashboard.invalidate(),
        utils.work.listTickets.invalidate(),
        utils.work.listGoals.invalidate(),
      ])
    },
  })

  const savedGoalViews = useMemo(
    () => (goalViewsQuery.data ?? []).filter((view) => view.entityKind === 'goal'),
    [goalViewsQuery.data]
  )
  const savedTicketViews = useMemo(
    () => (ticketViewsQuery.data ?? []).filter((view) => view.entityKind === 'ticket'),
    [ticketViewsQuery.data]
  )

  const selectedGoalSavedView = useMemo(
    () => savedGoalViews.find((view) => view.id === selectedGoalViewId) ?? null,
    [savedGoalViews, selectedGoalViewId]
  )
  const selectedTicketSavedView = useMemo(
    () => savedTicketViews.find((view) => view.id === selectedTicketViewId) ?? null,
    [savedTicketViews, selectedTicketViewId]
  )

  const goalOptions = goalOptionsQuery.data ?? []
  const initiativeOptions = initiativesQuery.data ?? []
  const userOptions = useMemo(
    () =>
      (membersQuery.data ?? [])
        .filter((member) => member.kind === 'user')
        .map((member) => ({
          id: member.id,
          label: member.name || member.email,
        })),
    [membersQuery.data]
  )
  const agentOptions = useMemo(
    () =>
      (agentsQuery.data ?? []).map((agent) => ({
        id: agent.id,
        label: agent.name,
      })),
    [agentsQuery.data]
  )
  const teamOptions = useMemo(
    () =>
      (teamsQuery.data ?? []).map((team) => ({
        id: team.id,
        label: team.name,
      })),
    [teamsQuery.data]
  )

  const dashboard = dashboardQuery.data
  const goals = useMemo(() => goalsQuery.data ?? [], [goalsQuery.data])
  const tickets = useMemo(() => ticketsQuery.data ?? [], [ticketsQuery.data])
  const suggestions = suggestionQuery.data ?? []

  useEffect(() => {
    setSelectedTicketIds((current) =>
      current.filter((ticketId) => tickets.some((ticket) => ticket.id === ticketId))
    )
  }, [tickets])

  function markGoalFiltersDirty(next: GoalListInput) {
    setGoalFilters(next)
    setSelectedGoalViewId(null)
  }

  function markTicketFiltersDirty(next: TicketListInput) {
    setTicketFilters(next)
    setSelectedTicketViewId(null)
  }

  function applyGoalView(viewId: string, filters: GoalListInput) {
    setGoalFilters(normalizeGoalFilters(filters))
    setGoalGroupBy(null)
    setSelectedGoalViewId(viewId)
  }

  function applySavedGoalView(viewId: string, filters: GoalListInput, groupBy: string | null) {
    setGoalFilters(normalizeGoalFilters(filters))
    setGoalGroupBy((groupBy as GoalGroupBy | null) ?? null)
    setSelectedGoalViewId(viewId)
  }

  function applyTicketView(viewId: string, filters: TicketListInput) {
    setTicketFilters(normalizeTicketFilters(filters))
    setSelectedTicketViewId(viewId)
  }

  function openSaveDialog(entityKind: SaveEntityKind) {
    setSaveEntityKind(entityKind)
    setSaveViewName(
      entityKind === 'goal'
        ? (selectedGoalSavedView?.name ??
            BUILT_IN_GOAL_VIEWS.find((view) => view.id === selectedGoalViewId)?.name ??
            '')
        : (selectedTicketSavedView?.name ??
            BUILT_IN_TICKET_VIEWS.find((view) => view.id === selectedTicketViewId)?.name ??
            '')
    )
    setSaveDialogOpen(true)
  }

  function handleSaveView() {
    if (!saveViewName.trim()) return
    if (saveEntityKind === 'goal') {
      upsertViewMutation.mutate({
        viewId: selectedGoalSavedView?.id,
        view: {
          entityKind: 'goal',
          name: saveViewName.trim(),
          filters: goalFilters,
          groupBy: goalGroupBy,
        },
      })
      return
    }

    upsertViewMutation.mutate({
      viewId: selectedTicketSavedView?.id,
      view: {
        entityKind: 'ticket',
        name: saveViewName.trim(),
        filters: ticketFilters,
        groupBy: null,
      },
    })
  }

  function handleDeleteSelectedView(entityKind: SaveEntityKind) {
    const selected = entityKind === 'goal' ? selectedGoalSavedView : selectedTicketSavedView
    if (!selected) return

    deleteViewMutation.mutate(
      { viewId: selected.id },
      {
        onSuccess: () => {
          if (entityKind === 'goal') {
            const fallback = BUILT_IN_GOAL_VIEWS[0]!
            setGoalGroupBy(null)
            applyGoalView(fallback.id, fallback.filters)
          } else {
            const fallback = BUILT_IN_TICKET_VIEWS[0]!
            applyTicketView(fallback.id, fallback.filters)
          }
        },
      }
    )
  }

  function toggleTicketSelection(ticketId: string, checked: boolean) {
    setSelectedTicketIds((current) =>
      checked ? [...new Set([...current, ticketId])] : current.filter((id) => id !== ticketId)
    )
  }

  function toggleAllTicketSelection(checked: boolean) {
    setSelectedTicketIds(checked ? tickets.map((ticket) => ticket.id) : [])
  }

  function applyBulkTicketChanges() {
    if (selectedTicketIds.length === 0) return

    const patch: {
      status?: TicketStatus
      assigneeKind?: ActorKind | null
      assigneeRef?: string | null
    } = {}

    if (bulkTicketStatus) {
      patch.status = bulkTicketStatus
    }

    if (bulkAssigneeKind) {
      patch.assigneeKind = bulkAssigneeKind
      patch.assigneeRef = bulkAssigneeRef || null
    }

    if (Object.keys(patch).length === 0) return

    bulkUpdateTicketsMutation.mutate({
      ticketIds: selectedTicketIds,
      patch,
    })
  }

  if (dashboardQuery.isLoading && !dashboard) {
    return (
      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="py-10 text-sm text-muted-foreground">Loading work…</CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 lg:grid-cols-5">
        <SummaryCard
          label="Open Goals"
          value={dashboard?.summary.openGoalCount ?? 0}
          icon={IconTargetArrow}
        />
        <SummaryCard
          label="At Risk"
          value={dashboard?.summary.atRiskGoalCount ?? 0}
          icon={IconAlertTriangle}
        />
        <SummaryCard
          label="Active Tickets"
          value={dashboard?.summary.activeTicketCount ?? 0}
          icon={IconPlayerPlay}
        />
        <SummaryCard
          label="Blocked"
          value={dashboard?.summary.blockedTicketCount ?? 0}
          icon={IconClock}
        />
        <SummaryCard
          label="Unclaimed"
          value={dashboard?.summary.unclaimedTicketCount ?? 0}
          icon={IconRefresh}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Org Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{dashboard?.orgSummary}</p>
              <div className="grid gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 md:grid-cols-2 xl:grid-cols-4">
                <div className="bg-white/[0.03] p-3">
                  <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">
                    My Tickets
                  </p>
                  <p className="mt-2 text-xl font-semibold tabular-nums">
                    {dashboard?.summary.myTicketCount ?? 0}
                  </p>
                </div>
                <div className="bg-white/[0.03] p-3">
                  <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">
                    My Team Queue
                  </p>
                  <p className="mt-2 text-xl font-semibold tabular-nums">
                    {dashboard?.summary.myTeamTicketCount ?? 0}
                  </p>
                </div>
                <div className="bg-white/[0.03] p-3">
                  <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">
                    Stale
                  </p>
                  <p className="mt-2 text-xl font-semibold tabular-nums">
                    {dashboard?.summary.staleTicketCount ?? 0}
                  </p>
                </div>
                <div className="bg-white/[0.03] p-3">
                  <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">
                    Untracked Sessions
                  </p>
                  <p className="mt-2 text-xl font-semibold tabular-nums">
                    {dashboard?.untrackedWork.length ?? 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as WorkTab)}>
            <TabsList variant="line">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="goals">Goals</TabsTrigger>
              <TabsTrigger value="tickets">Tickets</TabsTrigger>
              <TabsTrigger value="untracked">Untracked Work</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-6">
              <div className="grid gap-6 lg:grid-cols-2">
                <SectionList
                  title="At-Risk Goals"
                  empty="No goals are currently at risk."
                  items={(dashboard?.atRiskGoals ?? []).map((goal) => (
                    <Link
                      key={goal.id}
                      href={`/work/goals/${goal.id}`}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 transition hover:bg-white/5"
                    >
                      <span className="truncate text-sm">{goal.title}</span>
                      <WorkStatusBadge status={goal.status} />
                    </Link>
                  ))}
                />
                <SectionList
                  title="Blocked Tickets"
                  empty="No tickets are blocked."
                  items={(dashboard?.blockedTickets ?? []).map((ticket) => (
                    <Link
                      key={ticket.id}
                      href={`/work/tickets/${ticket.id}`}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 transition hover:bg-white/5"
                    >
                      <span className="truncate text-sm">{ticket.title}</span>
                      <ActorLabel actor={ticket.assignee} />
                    </Link>
                  ))}
                />
                <SectionList
                  title="Unclaimed Tickets"
                  empty="No unclaimed tickets."
                  items={(dashboard?.unclaimedTickets ?? []).map((ticket) => (
                    <Link
                      key={ticket.id}
                      href={`/work/tickets/${ticket.id}`}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 transition hover:bg-white/5"
                    >
                      <span className="truncate text-sm">{ticket.title}</span>
                      <WorkStatusBadge status={ticket.status} />
                    </Link>
                  ))}
                />
                <SectionList
                  title="Recent Work Updates"
                  empty="No updates yet."
                  items={(dashboard?.recentUpdates ?? []).map((update) => (
                    <div
                      key={update.id}
                      className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Badge variant="outline">{update.kind}</Badge>
                        <span className="text-xs text-muted-foreground">
                          <RelativeTime timestamp={update.created_at} />
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{update.body}</p>
                    </div>
                  ))}
                />
              </div>

              <Card className="border-white/10 bg-white/[0.02]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Workload</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(dashboard?.workload ?? []).length > 0 ? (
                    dashboard?.workload.map((entry) => (
                      <div
                        key={entry.key}
                        className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
                      >
                        <span className="text-sm">{entry.label}</span>
                        <Badge variant={entry.count >= 3 ? 'destructive' : 'outline'}>
                          {entry.count} open
                        </Badge>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No open workload yet.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="goals" className="mt-4 space-y-4">
              <Card className="border-white/10 bg-white/[0.02]">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-sm">Goal Portfolio</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Focus the goal list around outcomes, health, and ownership instead of raw
                        objects.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => openSaveDialog('goal')}>
                        <IconDeviceFloppy className="h-3.5 w-3.5" />
                        {selectedGoalSavedView ? 'Save Changes' : 'Save View'}
                      </Button>
                      {selectedGoalSavedView ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeleteSelectedView('goal')}
                          disabled={deleteViewMutation.isPending}
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                          Delete View
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {BUILT_IN_GOAL_VIEWS.map((view) => (
                        <ViewChip
                          key={view.id}
                          label={view.name}
                          active={selectedGoalViewId === view.id}
                          onClick={() => applyGoalView(view.id, view.filters)}
                        />
                      ))}
                    </div>
                    {savedGoalViews.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                          Saved
                        </span>
                        {savedGoalViews.map((view) => (
                          <ViewChip
                            key={view.id}
                            label={view.name}
                            active={selectedGoalViewId === view.id}
                            onClick={() =>
                              applySavedGoalView(
                                view.id,
                                normalizeGoalFilters(view.filters),
                                view.groupBy
                              )
                            }
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_180px_180px_180px_170px]">
                    <div className="relative">
                      <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={goalFilters.q ?? ''}
                        onChange={(event) =>
                          markGoalFiltersDirty(
                            normalizeGoalFilters({
                              ...goalFilters,
                              q: event.target.value || undefined,
                            })
                          )
                        }
                        placeholder="Search outcomes, owners, and priorities"
                        className="pl-9"
                      />
                    </div>
                    <NativeSelect
                      value={goalFilters.initiativeId ?? ''}
                      onChange={(event) =>
                        markGoalFiltersDirty(
                          normalizeGoalFilters({
                            ...goalFilters,
                            initiativeId: event.target.value || undefined,
                          })
                        )
                      }
                    >
                      <NativeSelectOption value="">All initiatives</NativeSelectOption>
                      {initiativeOptions.map((initiative) => (
                        <NativeSelectOption key={initiative.id} value={initiative.id}>
                          {initiative.title}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <NativeSelect
                      value={goalStatusPresetValue(goalFilters)}
                      onChange={(event) =>
                        markGoalFiltersDirty(
                          normalizeGoalFilters({
                            ...goalFilters,
                            statuses: goalStatusesFromPreset(event.target.value),
                            staleOnly: event.target.value === 'stale',
                          })
                        )
                      }
                    >
                      <NativeSelectOption value="all">All statuses</NativeSelectOption>
                      <NativeSelectOption value="active">Active portfolio</NativeSelectOption>
                      <NativeSelectOption value="attention">Attention only</NativeSelectOption>
                      <NativeSelectOption value="stale">Stale</NativeSelectOption>
                      <NativeSelectOption value="done">Done</NativeSelectOption>
                      <NativeSelectOption value="draft">Draft</NativeSelectOption>
                      <NativeSelectOption value="custom">Custom view</NativeSelectOption>
                    </NativeSelect>
                    <NativeSelect
                      value={`${goalFilters.sort?.field ?? 'updated_at'}:${goalFilters.sort?.direction ?? 'desc'}`}
                      onChange={(event) => {
                        const [field, direction] = event.target.value.split(':')
                        markGoalFiltersDirty(
                          normalizeGoalFilters({
                            ...goalFilters,
                            sort: {
                              field:
                                field === 'created_at' || field === 'title' || field === 'status'
                                  ? field
                                  : 'updated_at',
                              direction: direction === 'asc' ? 'asc' : 'desc',
                            },
                          })
                        )
                      }}
                    >
                      <NativeSelectOption value="updated_at:desc">
                        Recently updated
                      </NativeSelectOption>
                      <NativeSelectOption value="created_at:desc">
                        Recently created
                      </NativeSelectOption>
                      <NativeSelectOption value="title:asc">Title A-Z</NativeSelectOption>
                      <NativeSelectOption value="status:asc">Status</NativeSelectOption>
                    </NativeSelect>
                    <NativeSelect
                      value={goalGroupBy ?? ''}
                      onChange={(event) => {
                        setGoalGroupBy((event.target.value as GoalGroupBy) || null)
                        setSelectedGoalViewId(null)
                      }}
                    >
                      <NativeSelectOption value="">No grouping</NativeSelectOption>
                      <NativeSelectOption value="health">Group by health</NativeSelectOption>
                      <NativeSelectOption value="owner">Group by owner</NativeSelectOption>
                      <NativeSelectOption value="team">Group by team</NativeSelectOption>
                      <NativeSelectOption value="status">Group by status</NativeSelectOption>
                    </NativeSelect>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{goals.length} goals in view</span>
                    <span>
                      {selectedGoalSavedView
                        ? `Saved view: ${selectedGoalSavedView.name}`
                        : selectedGoalViewId
                          ? BUILT_IN_GOAL_VIEWS.find((view) => view.id === selectedGoalViewId)
                              ?.description
                          : 'Unsaved view'}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <GoalTable goals={goals} groupBy={goalGroupBy} />
            </TabsContent>

            <TabsContent value="tickets" className="mt-4 space-y-4">
              <Card className="border-white/10 bg-white/[0.02]">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-sm">Ticket Queue</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Saved queue views keep the ticket surface usable once the backlog stops
                        fitting in your head.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => openSaveDialog('ticket')}>
                        <IconDeviceFloppy className="h-3.5 w-3.5" />
                        {selectedTicketSavedView ? 'Save Changes' : 'Save View'}
                      </Button>
                      {selectedTicketSavedView ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeleteSelectedView('ticket')}
                          disabled={deleteViewMutation.isPending}
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                          Delete View
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {BUILT_IN_TICKET_VIEWS.map((view) => (
                        <ViewChip
                          key={view.id}
                          label={view.name}
                          active={selectedTicketViewId === view.id}
                          onClick={() => applyTicketView(view.id, view.filters)}
                        />
                      ))}
                    </div>
                    {savedTicketViews.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                          Saved
                        </span>
                        {savedTicketViews.map((view) => (
                          <ViewChip
                            key={view.id}
                            label={view.name}
                            active={selectedTicketViewId === view.id}
                            onClick={() =>
                              applyTicketView(view.id, normalizeTicketFilters(view.filters))
                            }
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_140px_160px_200px_180px]">
                    <div className="relative">
                      <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={ticketFilters.q ?? ''}
                        onChange={(event) =>
                          markTicketFiltersDirty(
                            normalizeTicketFilters({
                              ...ticketFilters,
                              q: event.target.value || undefined,
                            })
                          )
                        }
                        placeholder="Search ticket title, body, or id"
                        className="pl-9"
                      />
                    </div>
                    <NativeSelect
                      value={ticketFilters.scope ?? 'all'}
                      onChange={(event) =>
                        markTicketFiltersDirty(
                          normalizeTicketFilters({
                            ...ticketFilters,
                            scope: event.target.value as TicketScope,
                          })
                        )
                      }
                    >
                      <NativeSelectOption value="mine">Mine</NativeSelectOption>
                      <NativeSelectOption value="my_team">My Team</NativeSelectOption>
                      <NativeSelectOption value="unclaimed">Unclaimed</NativeSelectOption>
                      <NativeSelectOption value="all">All</NativeSelectOption>
                    </NativeSelect>
                    <NativeSelect
                      value={ticketStatusPresetValue(ticketFilters)}
                      onChange={(event) =>
                        markTicketFiltersDirty(
                          normalizeTicketFilters({
                            ...ticketFilters,
                            statuses: ticketStatusesFromPreset(event.target.value),
                          })
                        )
                      }
                    >
                      <NativeSelectOption value="open">Open work</NativeSelectOption>
                      <NativeSelectOption value="active">Ready + active</NativeSelectOption>
                      <NativeSelectOption value="blocked">Blocked</NativeSelectOption>
                      <NativeSelectOption value="in_progress">In progress</NativeSelectOption>
                      <NativeSelectOption value="done">Done</NativeSelectOption>
                      <NativeSelectOption value="inbox">Inbox</NativeSelectOption>
                      <NativeSelectOption value="all">All statuses</NativeSelectOption>
                      <NativeSelectOption value="custom">Custom view</NativeSelectOption>
                    </NativeSelect>
                    <NativeSelect
                      value={ticketFilters.goalId ?? ''}
                      onChange={(event) =>
                        markTicketFiltersDirty(
                          normalizeTicketFilters({
                            ...ticketFilters,
                            goalId: event.target.value || undefined,
                          })
                        )
                      }
                    >
                      <NativeSelectOption value="">All goals</NativeSelectOption>
                      {goalOptions.map((goal) => (
                        <NativeSelectOption key={goal.id} value={goal.id}>
                          {goal.title}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <NativeSelect
                      value={`${ticketFilters.sort?.field ?? 'updated_at'}:${ticketFilters.sort?.direction ?? 'desc'}`}
                      onChange={(event) => {
                        const [field, direction] = event.target.value.split(':')
                        markTicketFiltersDirty(
                          normalizeTicketFilters({
                            ...ticketFilters,
                            sort: {
                              field:
                                field === 'created_at' || field === 'title' || field === 'status'
                                  ? field
                                  : 'updated_at',
                              direction: direction === 'asc' ? 'asc' : 'desc',
                            },
                          })
                        )
                      }}
                    >
                      <NativeSelectOption value="updated_at:desc">
                        Recently updated
                      </NativeSelectOption>
                      <NativeSelectOption value="created_at:desc">
                        Recently created
                      </NativeSelectOption>
                      <NativeSelectOption value="title:asc">Title A-Z</NativeSelectOption>
                      <NativeSelectOption value="status:asc">Status</NativeSelectOption>
                    </NativeSelect>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant={ticketFilters.staleOnly ? 'default' : 'outline'}
                        onClick={() =>
                          markTicketFiltersDirty(
                            normalizeTicketFilters({
                              ...ticketFilters,
                              staleOnly: !ticketFilters.staleOnly,
                            })
                          )
                        }
                      >
                        Stale only
                      </Button>
                      {selectedTicketIds.length > 0 ? (
                        <Badge variant="outline">{selectedTicketIds.length} selected</Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {tickets.length} tickets in view
                      {selectedTicketSavedView
                        ? ` • Saved view: ${selectedTicketSavedView.name}`
                        : selectedTicketViewId
                          ? ` • ${BUILT_IN_TICKET_VIEWS.find((view) => view.id === selectedTicketViewId)?.description ?? 'Built-in view'}`
                          : ' • Unsaved view'}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {selectedTicketIds.length > 0 ? (
                <Card className="border-white/10 bg-white/[0.02]">
                  <CardContent className="flex flex-wrap items-center gap-2 p-3">
                    <NativeSelect
                      value={bulkTicketStatus}
                      onChange={(event) =>
                        setBulkTicketStatus(event.target.value as TicketStatus | '')
                      }
                      className="w-[170px]"
                    >
                      <NativeSelectOption value="">Bulk status</NativeSelectOption>
                      <NativeSelectOption value="inbox">Inbox</NativeSelectOption>
                      <NativeSelectOption value="ready">Ready</NativeSelectOption>
                      <NativeSelectOption value="in_progress">In progress</NativeSelectOption>
                      <NativeSelectOption value="blocked">Blocked</NativeSelectOption>
                      <NativeSelectOption value="done">Done</NativeSelectOption>
                      <NativeSelectOption value="canceled">Canceled</NativeSelectOption>
                    </NativeSelect>
                    <NativeSelect
                      value={bulkAssigneeKind}
                      onChange={(event) => {
                        setBulkAssigneeKind(event.target.value as ActorKind | '')
                        setBulkAssigneeRef('')
                      }}
                      className="w-[160px]"
                    >
                      <NativeSelectOption value="">Bulk assignee</NativeSelectOption>
                      <NativeSelectOption value="user">User</NativeSelectOption>
                      <NativeSelectOption value="agent">Agent</NativeSelectOption>
                      <NativeSelectOption value="team">Team</NativeSelectOption>
                    </NativeSelect>
                    <NativeSelect
                      value={bulkAssigneeRef}
                      onChange={(event) => setBulkAssigneeRef(event.target.value)}
                      className="w-[220px]"
                      disabled={!bulkAssigneeKind}
                    >
                      <NativeSelectOption value="">
                        {bulkAssigneeKind ? 'Select assignee' : 'Choose assignee kind first'}
                      </NativeSelectOption>
                      {(bulkAssigneeKind === 'user'
                        ? userOptions
                        : bulkAssigneeKind === 'agent'
                          ? agentOptions
                          : teamOptions
                      ).map((option) => (
                        <NativeSelectOption key={option.id} value={option.id}>
                          {option.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <Button
                      size="sm"
                      onClick={applyBulkTicketChanges}
                      disabled={
                        bulkUpdateTicketsMutation.isPending ||
                        (!bulkTicketStatus && !bulkAssigneeKind) ||
                        (bulkAssigneeKind !== '' && !bulkAssigneeRef)
                      }
                    >
                      Apply to selected
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedTicketIds([])}
                      disabled={bulkUpdateTicketsMutation.isPending}
                    >
                      Clear selection
                    </Button>
                  </CardContent>
                </Card>
              ) : null}

              <TicketTable
                tickets={tickets}
                selectedTicketIds={selectedTicketIds}
                onToggleTicket={toggleTicketSelection}
                onToggleAllTickets={toggleAllTicketSelection}
              />
            </TabsContent>

            <TabsContent value="untracked" className="mt-4">
              <Card className="border-white/10 bg-white/[0.02]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Untracked Sessions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(dashboard?.untrackedWork ?? []).length > 0 ? (
                    dashboard?.untrackedWork.map((session) => (
                      <div
                        key={session.session_key}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {session.title || session.latest_work_title || 'Untitled session'}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {session.session_key}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/sessions/${encodeURIComponent(session.session_key)}`}
                            className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-white/5 hover:text-white"
                          >
                            Open
                            <IconArrowRight className="h-3.5 w-3.5" />
                          </Link>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              promoteSessionMutation.mutate({ sessionKey: session.session_key })
                            }
                            disabled={promoteSessionMutation.isPending}
                          >
                            Promote to Ticket
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nothing is running outside the work model right now.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-6">
          {activeTab === 'overview' ? (
            <Card className="border-white/10 bg-white/[0.02]">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <IconSparkles className="h-4 w-4" />
                  Quick Actions
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Overview is for reading the queue. Jump into the goal or ticket tabs when you want
                  to shape new work.
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => setActiveTab('goals')}
                >
                  <span>Open goal portfolio</span>
                  <IconArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => setActiveTab('tickets')}
                >
                  <span>Open ticket queue</span>
                  <IconArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => setActiveTab('untracked')}
                >
                  <span>Review untracked sessions</span>
                  <IconArrowRight className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {activeTab === 'goals' ? (
            <Card className="border-white/10 bg-white/[0.02]">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <IconPlus className="h-4 w-4" />
                  New Goal
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Create work at the goal layer inside an initiative, then break it down into
                  tickets.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  value={goalTitle}
                  onChange={(event) => setGoalTitle(event.target.value)}
                  placeholder="Ship the operator surface"
                />
                <NativeSelect
                  value={goalInitiativeId}
                  onChange={(event) => setGoalInitiativeId(event.target.value)}
                  className="w-full"
                >
                  <NativeSelectOption value="">No initiative yet</NativeSelectOption>
                  {initiativeOptions.map((initiative) => (
                    <NativeSelectOption key={initiative.id} value={initiative.id}>
                      {initiative.title}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Textarea
                  value={goalOutcome}
                  onChange={(event) => setGoalOutcome(event.target.value)}
                  placeholder="What outcome should this goal produce?"
                  rows={4}
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <NativeSelect
                    value={goalOwnerKind}
                    onChange={(event) => {
                      setGoalOwnerKind(event.target.value as ActorKind | '')
                      setGoalOwnerRef('')
                    }}
                    className="w-full"
                  >
                    <NativeSelectOption value="">No owner</NativeSelectOption>
                    <NativeSelectOption value="user">User</NativeSelectOption>
                    <NativeSelectOption value="agent">Agent</NativeSelectOption>
                    <NativeSelectOption value="team">Team</NativeSelectOption>
                  </NativeSelect>
                  <NativeSelect
                    value={goalOwnerRef}
                    onChange={(event) => setGoalOwnerRef(event.target.value)}
                    className="w-full"
                    disabled={!goalOwnerKind}
                  >
                    <NativeSelectOption value="">
                      {goalOwnerKind ? 'Select owner' : 'Choose owner kind first'}
                    </NativeSelectOption>
                    {(goalOwnerKind === 'user'
                      ? userOptions
                      : goalOwnerKind === 'agent'
                        ? agentOptions
                        : teamOptions
                    ).map((option) => (
                      <NativeSelectOption key={option.id} value={option.id}>
                        {option.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <Button
                  className="w-full"
                  onClick={() =>
                    createGoalMutation.mutate({
                      title: goalTitle,
                      outcome: goalOutcome,
                      initiativeId: goalInitiativeId || null,
                      ownerKind: goalOwnerKind || null,
                      ownerRef: goalOwnerRef || null,
                    })
                  }
                  disabled={
                    !goalTitle.trim() || !goalOutcome.trim() || createGoalMutation.isPending
                  }
                >
                  Create Goal
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {activeTab === 'tickets' ? (
            <Card className="border-white/10 bg-white/[0.02]">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <IconPlayerPlay className="h-4 w-4" />
                  New Ticket
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Add execution work once the goal already exists and someone can own the next move.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  value={ticketTitle}
                  onChange={(event) => setTicketTitle(event.target.value)}
                  placeholder="Review routing regressions"
                />
                <Textarea
                  value={ticketBody}
                  onChange={(event) => setTicketBody(event.target.value)}
                  placeholder="Add the concrete work to do, constraints, or links."
                  rows={4}
                />
                <NativeSelect
                  value={ticketGoalId}
                  onChange={(event) => setTicketGoalId(event.target.value)}
                  className="w-full"
                >
                  <NativeSelectOption value="">No goal</NativeSelectOption>
                  {goalOptions.map((goal) => (
                    <NativeSelectOption key={goal.id} value={goal.id}>
                      {goal.title}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <div className="grid gap-2 sm:grid-cols-2">
                  <NativeSelect
                    value={ticketStatus}
                    onChange={(event) => setTicketStatus(event.target.value as 'inbox' | 'ready')}
                    className="w-full"
                  >
                    <NativeSelectOption value="ready">Ready</NativeSelectOption>
                    <NativeSelectOption value="inbox">Inbox</NativeSelectOption>
                  </NativeSelect>
                  <NativeSelect
                    value={ticketAssigneeKind}
                    onChange={(event) => {
                      setTicketAssigneeKind(event.target.value as ActorKind | '')
                      setTicketAssigneeRef('')
                    }}
                    className="w-full"
                  >
                    <NativeSelectOption value="">No assignee</NativeSelectOption>
                    <NativeSelectOption value="user">User</NativeSelectOption>
                    <NativeSelectOption value="agent">Agent</NativeSelectOption>
                    <NativeSelectOption value="team">Team</NativeSelectOption>
                  </NativeSelect>
                </div>
                <NativeSelect
                  value={ticketAssigneeRef}
                  onChange={(event) => setTicketAssigneeRef(event.target.value)}
                  className="w-full"
                  disabled={!ticketAssigneeKind}
                >
                  <NativeSelectOption value="">
                    {ticketAssigneeKind ? 'Select assignee' : 'Choose assignee kind first'}
                  </NativeSelectOption>
                  {(ticketAssigneeKind === 'user'
                    ? userOptions
                    : ticketAssigneeKind === 'agent'
                      ? agentOptions
                      : teamOptions
                  ).map((option) => (
                    <NativeSelectOption key={option.id} value={option.id}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <SuggestedTickets suggestions={suggestions} />
                <Button
                  className="w-full"
                  onClick={() =>
                    createTicketMutation.mutate({
                      title: ticketTitle,
                      body: ticketBody || null,
                      goalId: ticketGoalId || null,
                      status: ticketStatus,
                      assigneeKind: ticketAssigneeKind || null,
                      assigneeRef: ticketAssigneeRef || null,
                    })
                  }
                  disabled={!ticketTitle.trim() || createTicketMutation.isPending}
                >
                  Create Ticket
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <IconLink className="h-4 w-4" />
                Heartbeats
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(dashboard?.heartbeatUpdates ?? []).length > 0 ? (
                (dashboard?.heartbeatUpdates ?? []).map((update) => (
                  <div
                    key={update.id}
                    className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
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
                <p className="text-sm text-muted-foreground">
                  Heartbeat updates will appear here once recurring work summaries are configured on
                  goals or teams.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {saveEntityKind === 'goal' ? 'Save Goal View' : 'Save Ticket View'}
            </DialogTitle>
            <DialogDescription>
              Save the current filters and sort so you can come back to this slice of work without
              rebuilding it by hand.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={saveViewName}
              onChange={(event) => setSaveViewName(event.target.value)}
              placeholder={saveEntityKind === 'goal' ? 'Launch blockers' : 'Agent triage queue'}
            />
            <p className="text-xs text-muted-foreground">
              {saveEntityKind === 'goal'
                ? selectedGoalSavedView
                  ? 'This will update the selected saved view.'
                  : 'This will create a new saved view.'
                : selectedTicketSavedView
                  ? 'This will update the selected saved view.'
                  : 'This will create a new saved view.'}
            </p>
          </div>
          <DialogFooter showCloseButton>
            <Button
              onClick={handleSaveView}
              disabled={!saveViewName.trim() || upsertViewMutation.isPending}
            >
              <IconDeviceFloppy className="h-3.5 w-3.5" />
              Save View
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
