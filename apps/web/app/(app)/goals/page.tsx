'use client'

import { useMemo, useState } from 'react'
import {
  IconAlertTriangle,
  IconArrowsSort,
  IconArrowRight,
  IconCircleCheck,
  IconClock,
  IconFilter,
  IconLayoutKanban,
  IconSearch,
  IconTargetArrow,
  IconUserPlus,
  IconUsers,
  IconZzz,
} from '@tabler/icons-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type TicketStatus = 'ready' | 'in_progress' | 'blocked' | 'done'
type QueueHealth = 'healthy' | 'at_risk' | 'blocked'
type QueueView = 'all' | 'unassigned' | 'stale' | 'blocked' | 'active'
type SortKey = 'priority' | 'staleness' | 'updated' | 'title'

type TicketQueueRow = {
  id: string
  number: number
  title: string
  status: TicketStatus
  goal: string
  goalId: string
  assignee: string | null
  assigneeType: 'agent' | 'user' | null
  updatedHoursAgo: number
  createdHoursAgo: number
  commentCount: number
  receiptCount: number
  rapidAssignHint: boolean
}

const operatorJobs = [
  {
    title: 'Backlog triage should stay fast past 50 tickets',
    detail:
      'Operators need one dense queue they can scan, filter, and act on without paging through tiny lists.',
  },
  {
    title: 'Stale unassigned work gets surfaced first',
    detail:
      'Any ticket sitting unassigned for more than 48 hours should rise to the top in the default queue view.',
  },
  {
    title: 'Rapid-fire assignment is a first-class action',
    detail:
      'Assigning a burst of tickets should feel like inbox triage, not opening 5 modal flows in a row.',
  },
  {
    title: 'Filters need to map to operator questions',
    detail:
      'Status, assignee, goal, and staleness filters should narrow the queue in one or two interactions.',
  },
]

const implementationPlan = [
  {
    icon: IconLayoutKanban,
    title: 'Queue data contract',
    bullets: [
      'Fetch enough fields to rank and filter tickets server-side: status, assignee, goal, created/updated timestamps, and last receipt or comment time.',
      'Represent staleness explicitly so the default sort stays deterministic instead of depending on fragile client heuristics.',
      'Keep a lightweight summary row shape so the queue stays responsive at 50+ tickets and can later paginate cleanly.',
    ],
  },
  {
    icon: IconFilter,
    title: 'Operator queue UX',
    bullets: [
      'Default to stale-unassigned-first ordering, then blocked, then newest movement, so attention lands where intervention matters most.',
      'Let operators combine quick views with exact filters instead of forcing one giant advanced search form.',
      'Keep queue actions inline: assign, inspect receipts, jump to goal, or open the ticket thread without losing list context.',
    ],
  },
  {
    icon: IconUsers,
    title: 'Rapid assignment flow',
    bullets: [
      'Support selecting multiple tickets and assigning them in one pass to hit the 5 tickets in <2 minute target.',
      'Show assignment coverage inline so the operator can see which goals or statuses are under-owned before clicking anything.',
      'Echo assignment receipts immediately in the queue row once the real mutation exists.',
    ],
  },
  {
    icon: IconSearch,
    title: 'Follow-on scaling work',
    bullets: [
      'Move the current mock data to a real tRPC procedure backed by shared ticket/goal records and receipt timestamps.',
      'Add pagination or virtualization only when the real queue proves the first page is too heavy; don’t pre-optimise.',
      'Persist saved views after operators settle on stable triage slices like blocked-now, stale-unassigned, or agent-overload.',
    ],
  },
]

const queueRows: TicketQueueRow[] = [
  {
    id: '019cce7b-f90b-7763-8319-260d26a9b7dd',
    number: 184,
    title: 'Build scalable ticket queue',
    status: 'ready',
    goal: 'Make Nitejar feel like an operator product, not a playground',
    goalId: 'OP-12',
    assignee: null,
    assigneeType: null,
    updatedHoursAgo: 55,
    createdHoursAgo: 58,
    commentCount: 4,
    receiptCount: 1,
    rapidAssignHint: true,
  },
  {
    id: '019cce7b-f176-73be-b791-8bb84a036ce6',
    number: 183,
    title: 'Document operator jobs and acceptance criteria',
    status: 'done',
    goal: 'Make Nitejar feel like an operator product, not a playground',
    goalId: 'OP-12',
    assignee: 'CEO',
    assigneeType: 'user',
    updatedHoursAgo: 2,
    createdHoursAgo: 30,
    commentCount: 6,
    receiptCount: 4,
    rapidAssignHint: false,
  },
  {
    id: '019ccf10-a1f2-7f20-8c9b-54c32c160001',
    number: 182,
    title: 'Ship goal portfolio data query',
    status: 'in_progress',
    goal: 'Make Nitejar feel like an operator product, not a playground',
    goalId: 'OP-12',
    assignee: '@founding_engineer',
    assigneeType: 'agent',
    updatedHoursAgo: 3,
    createdHoursAgo: 20,
    commentCount: 3,
    receiptCount: 2,
    rapidAssignHint: false,
  },
  {
    id: '019ccf10-a1f2-7f20-8c9b-54c32c160002',
    number: 181,
    title: 'Design agent roster intervention panel',
    status: 'ready',
    goal: 'Make Nitejar feel like an operator product, not a playground',
    goalId: 'OP-12',
    assignee: null,
    assigneeType: null,
    updatedHoursAgo: 78,
    createdHoursAgo: 96,
    commentCount: 1,
    receiptCount: 0,
    rapidAssignHint: true,
  },
  {
    id: '019ccf10-a1f2-7f20-8c9b-54c32c160003',
    number: 180,
    title: 'Backfill receipts on legacy completed tickets',
    status: 'blocked',
    goal: 'Receipts-first operator trust',
    goalId: 'OP-07',
    assignee: '@ops_agent',
    assigneeType: 'agent',
    updatedHoursAgo: 10,
    createdHoursAgo: 18,
    commentCount: 8,
    receiptCount: 1,
    rapidAssignHint: false,
  },
  {
    id: '019ccf10-a1f2-7f20-8c9b-54c32c160004',
    number: 179,
    title: 'Add goal-level stale activity indicators',
    status: 'ready',
    goal: 'Make Nitejar feel like an operator product, not a playground',
    goalId: 'OP-12',
    assignee: 'Josh',
    assigneeType: 'user',
    updatedHoursAgo: 49,
    createdHoursAgo: 60,
    commentCount: 2,
    receiptCount: 0,
    rapidAssignHint: false,
  },
  {
    id: '019ccf10-a1f2-7f20-8c9b-54c32c160005',
    number: 178,
    title: 'Queue filters should persist between sessions',
    status: 'ready',
    goal: 'Operator workflows stay in flow',
    goalId: 'OP-16',
    assignee: null,
    assigneeType: null,
    updatedHoursAgo: 51,
    createdHoursAgo: 70,
    commentCount: 0,
    receiptCount: 0,
    rapidAssignHint: true,
  },
  {
    id: '019ccf10-a1f2-7f20-8c9b-54c32c160006',
    number: 177,
    title: 'Expose last assignment actor in queue rows',
    status: 'in_progress',
    goal: 'Operator workflows stay in flow',
    goalId: 'OP-16',
    assignee: '@frontend_engineer',
    assigneeType: 'agent',
    updatedHoursAgo: 6,
    createdHoursAgo: 16,
    commentCount: 3,
    receiptCount: 2,
    rapidAssignHint: false,
  },
  {
    id: '019ccf10-a1f2-7f20-8c9b-54c32c160007',
    number: 176,
    title: 'Flag completed tickets without shipping receipts',
    status: 'blocked',
    goal: 'Receipts-first operator trust',
    goalId: 'OP-07',
    assignee: null,
    assigneeType: null,
    updatedHoursAgo: 83,
    createdHoursAgo: 88,
    commentCount: 5,
    receiptCount: 0,
    rapidAssignHint: true,
  },
  {
    id: '019ccf10-a1f2-7f20-8c9b-54c32c160008',
    number: 175,
    title: 'Keep ticket launch panel under three steps',
    status: 'ready',
    goal: 'Operator workflows stay in flow',
    goalId: 'OP-16',
    assignee: null,
    assigneeType: null,
    updatedHoursAgo: 12,
    createdHoursAgo: 24,
    commentCount: 1,
    receiptCount: 1,
    rapidAssignHint: true,
  },
]

const generatedRows: TicketQueueRow[] = Array.from({ length: 48 }, (_, index) => {
  const statusCycle = ['ready', 'in_progress', 'blocked', 'done'] as const
  const goals = [
    ['Make Nitejar feel like an operator product, not a playground', 'OP-12'],
    ['Receipts-first operator trust', 'OP-07'],
    ['Operator workflows stay in flow', 'OP-16'],
    ['Fast session launch at scale', 'OP-09'],
  ] as const
  const assignees = [null, '@founding_engineer', '@ops_agent', '@frontend_engineer', 'CEO', 'Josh']
  const goal = goals[index % goals.length] ?? goals[0]
  const status = statusCycle[index % statusCycle.length] ?? 'ready'
  const updatedHoursAgo = (index * 7) % 96
  const assignee = assignees[index % assignees.length] ?? null

  return {
    id: `mock-ticket-${index + 1}`,
    number: 174 - index,
    title: `Operator queue follow-up ${index + 1}`,
    status,
    goal: goal[0],
    goalId: goal[1],
    assignee,
    assigneeType: assignee?.startsWith('@') ? 'agent' : assignee ? 'user' : null,
    updatedHoursAgo,
    createdHoursAgo: updatedHoursAgo + 8,
    commentCount: index % 5,
    receiptCount: index % 4,
    rapidAssignHint: !assignee && status !== 'done',
  }
})

const allRows = [...queueRows, ...generatedRows]

function formatHours(hoursAgo: number): string {
  if (hoursAgo < 1) return 'just now'
  if (hoursAgo < 24) return `${hoursAgo}h ago`
  const days = Math.floor(hoursAgo / 24)
  const hours = hoursAgo % 24
  return hours === 0 ? `${days}d ago` : `${days}d ${hours}h ago`
}

function statusLabel(status: TicketStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'in_progress':
      return 'In progress'
    case 'blocked':
      return 'Blocked'
    case 'done':
      return 'Done'
  }
}

function healthForRow(row: TicketQueueRow): QueueHealth {
  if (row.status === 'blocked') return 'blocked'
  if (!row.assignee && row.updatedHoursAgo >= 48) return 'at_risk'
  return 'healthy'
}

function staleUnassignedScore(row: TicketQueueRow): number {
  const staleUnassigned = !row.assignee && row.updatedHoursAgo >= 48
  const blocked = row.status === 'blocked'
  const active = row.status === 'in_progress'

  if (staleUnassigned) return 1000 + row.updatedHoursAgo
  if (blocked) return 800 + row.updatedHoursAgo
  if (active) return 400 - row.updatedHoursAgo
  return 100 - row.updatedHoursAgo
}

function statusBadgeClass(status: TicketStatus): string {
  switch (status) {
    case 'ready':
      return 'border-sky-500/20 bg-sky-500/10 text-sky-200'
    case 'in_progress':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-200'
    case 'blocked':
      return 'border-red-500/20 bg-red-500/10 text-red-200'
    case 'done':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
  }
}

function healthBadgeClass(health: QueueHealth): string {
  switch (health) {
    case 'healthy':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
    case 'at_risk':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-200'
    case 'blocked':
      return 'border-red-500/20 bg-red-500/10 text-red-200'
  }
}

function healthLabel(health: QueueHealth): string {
  switch (health) {
    case 'healthy':
      return 'Healthy'
    case 'at_risk':
      return 'At risk'
    case 'blocked':
      return 'Blocked'
  }
}

function defaultBulkAssignees(rows: TicketQueueRow[]): string[] {
  const assignees = new Set<string>()
  rows.forEach((row) => {
    if (row.assignee) assignees.add(row.assignee)
  })
  return Array.from(assignees).sort((a, b) => a.localeCompare(b))
}

export default function GoalsPortfolioPage() {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | TicketStatus>('all')
  const [goalFilter, setGoalFilter] = useState<string>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')
  const [stalenessFilter, setStalenessFilter] = useState<'all' | 'stale' | 'fresh'>('all')
  const [view, setView] = useState<QueueView>('all')
  const [sortKey, setSortKey] = useState<SortKey>('priority')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkAssignee, setBulkAssignee] = useState<string>('')

  const goalOptions = useMemo(
    () => Array.from(new Set(allRows.map((row) => `${row.goalId}:::${row.goal}`))).sort(),
    []
  )
  const assigneeOptions = useMemo(() => defaultBulkAssignees(allRows), [])

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const result = allRows.filter((row) => {
      const matchesQuery =
        normalized.length === 0 ||
        row.title.toLowerCase().includes(normalized) ||
        row.goal.toLowerCase().includes(normalized) ||
        row.id.toLowerCase().includes(normalized) ||
        String(row.number).includes(normalized)

      const matchesStatus = statusFilter === 'all' || row.status === statusFilter
      const matchesGoal = goalFilter === 'all' || `${row.goalId}:::${row.goal}` === goalFilter
      const matchesAssignee =
        assigneeFilter === 'all' ||
        (assigneeFilter === 'unassigned' ? row.assignee === null : row.assignee === assigneeFilter)
      const isStale = row.updatedHoursAgo >= 48
      const matchesStaleness =
        stalenessFilter === 'all' || (stalenessFilter === 'stale' ? isStale : !isStale)
      const matchesView =
        view === 'all'
          ? true
          : view === 'unassigned'
            ? row.assignee === null && row.status !== 'done'
            : view === 'stale'
              ? isStale && row.status !== 'done'
              : view === 'blocked'
                ? row.status === 'blocked'
                : row.status === 'in_progress'

      return (
        matchesQuery &&
        matchesStatus &&
        matchesGoal &&
        matchesAssignee &&
        matchesStaleness &&
        matchesView
      )
    })

    return result.sort((left, right) => {
      if (sortKey === 'priority') return staleUnassignedScore(right) - staleUnassignedScore(left)
      if (sortKey === 'staleness') return right.updatedHoursAgo - left.updatedHoursAgo
      if (sortKey === 'updated') return left.updatedHoursAgo - right.updatedHoursAgo
      return left.title.localeCompare(right.title)
    })
  }, [assigneeFilter, goalFilter, query, sortKey, stalenessFilter, statusFilter, view])

  const selectedRows = filteredRows.filter((row) => selectedIds.includes(row.id))
  const staleUnassignedCount = filteredRows.filter(
    (row) => !row.assignee && row.updatedHoursAgo >= 48 && row.status !== 'done'
  ).length
  const blockedCount = filteredRows.filter((row) => row.status === 'blocked').length
  const inProgressCount = filteredRows.filter((row) => row.status === 'in_progress').length
  const unassignedCount = filteredRows.filter(
    (row) => row.assignee === null && row.status !== 'done'
  ).length

  const selectionCoverage =
    selectedRows.length === 0
      ? 'Pick tickets to simulate the rapid-fire assignment pass.'
      : `${selectedRows.length} selected · ${selectedRows.filter((row) => row.assignee === null).length} currently unassigned · target: assign 5 in under 2 minutes`

  return (
    <div className="space-y-6">
      <div className="max-w-5xl space-y-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Goal portfolio + ticket queue</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The current repo still lacks a real shared ticket/goal query in the web app, so this
            pass ships the operator-facing queue shape and interaction spec directly in the product
            surface. It is built around Job #4: triage a backlog quickly, keep stale unassigned work
            at the top, and make assignment bursts feel fast instead of ceremonial.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className="border-white/10 bg-white/[0.04] text-white">
            Spec-backed UI scaffold
          </Badge>
          <Badge className="border-red-500/20 bg-red-500/10 text-red-200">
            Real data query still missing in repo
          </Badge>
          <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-200">
            Default sort: stale unassigned &gt; 48h first
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {operatorJobs.map((item) => (
          <Card key={item.title} className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-white">{item.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{item.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)]">
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <CardTitle className="text-sm text-white">Ticket queue</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Dense backlog view designed for 50+ tickets, filter-first triage, and inline
                  assignment.
                </p>
              </div>
              <div className="grid w-full gap-2 md:grid-cols-2 xl:w-[420px] xl:grid-cols-1">
                <div className="relative">
                  <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search title, ticket number, goal, or id"
                    className="border-white/10 bg-black/20 pl-9 text-white placeholder:text-muted-foreground"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={view} onValueChange={(value) => setView(value as QueueView)}>
                    <SelectTrigger className="border-white/10 bg-black/20 text-white">
                      <SelectValue placeholder="Quick view" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All tickets</SelectItem>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      <SelectItem value="stale">Stale</SelectItem>
                      <SelectItem value="blocked">Blocked</SelectItem>
                      <SelectItem value="active">In progress</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)}>
                    <SelectTrigger className="border-white/10 bg-black/20 text-white">
                      <SelectValue placeholder="Sort" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="priority">Default priority</SelectItem>
                      <SelectItem value="staleness">Most stale</SelectItem>
                      <SelectItem value="updated">Recent movement</SelectItem>
                      <SelectItem value="title">Title</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
              <Select
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as 'all' | TicketStatus)}
              >
                <SelectTrigger className="border-white/10 bg-black/20 text-white">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="ready">Ready</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={assigneeFilter}
                onValueChange={(value) => setAssigneeFilter(value ?? 'all')}
              >
                <SelectTrigger className="border-white/10 bg-black/20 text-white">
                  <SelectValue placeholder="Assignee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All assignees</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {assigneeOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={goalFilter} onValueChange={(value) => setGoalFilter(value ?? 'all')}>
                <SelectTrigger className="border-white/10 bg-black/20 text-white">
                  <SelectValue placeholder="Goal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All goals</SelectItem>
                  {goalOptions.map((option) => {
                    const [goalId, goalTitle] = option.split(':::')
                    return (
                      <SelectItem key={option} value={option}>
                        {goalId} · {goalTitle}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>

              <Select
                value={stalenessFilter}
                onValueChange={(value) => setStalenessFilter(value as 'all' | 'stale' | 'fresh')}
              >
                <SelectTrigger className="border-white/10 bg-black/20 text-white">
                  <SelectValue placeholder="Staleness" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any age</SelectItem>
                  <SelectItem value="stale">Stale &gt; 48h</SelectItem>
                  <SelectItem value="fresh">Fresh &lt; 48h</SelectItem>
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="outline"
                className="justify-start border-white/10 bg-black/20 text-white hover:bg-white/5"
                onClick={() => {
                  setQuery('')
                  setStatusFilter('all')
                  setGoalFilter('all')
                  setAssigneeFilter('all')
                  setStalenessFilter('all')
                  setView('all')
                  setSortKey('priority')
                }}
              >
                <IconFilter className="mr-2 h-4 w-4" />
                Reset filters
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
                <div className="flex items-center justify-between text-amber-200">
                  <span className="text-xs font-medium uppercase tracking-[0.24em]">
                    Stale unassigned
                  </span>
                  <IconZzz className="h-4 w-4" />
                </div>
                <div className="mt-3 text-2xl font-semibold text-white">{staleUnassignedCount}</div>
                <p className="mt-1 text-sm text-amber-100/80">Default queue top slice.</p>
              </div>
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
                <div className="flex items-center justify-between text-red-200">
                  <span className="text-xs font-medium uppercase tracking-[0.24em]">Blocked</span>
                  <IconAlertTriangle className="h-4 w-4" />
                </div>
                <div className="mt-3 text-2xl font-semibold text-white">{blockedCount}</div>
                <p className="mt-1 text-sm text-red-100/80">Needs operator intervention.</p>
              </div>
              <div className="rounded-lg border border-sky-500/20 bg-sky-500/10 p-4">
                <div className="flex items-center justify-between text-sky-200">
                  <span className="text-xs font-medium uppercase tracking-[0.24em]">
                    Unassigned
                  </span>
                  <IconUserPlus className="h-4 w-4" />
                </div>
                <div className="mt-3 text-2xl font-semibold text-white">{unassignedCount}</div>
                <p className="mt-1 text-sm text-sky-100/80">Fast assign candidates.</p>
              </div>
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4">
                <div className="flex items-center justify-between text-emerald-200">
                  <span className="text-xs font-medium uppercase tracking-[0.24em]">
                    In progress
                  </span>
                  <IconCircleCheck className="h-4 w-4" />
                </div>
                <div className="mt-3 text-2xl font-semibold text-white">{inProgressCount}</div>
                <p className="mt-1 text-sm text-emerald-100/80">Already moving.</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-white/10">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="w-10 text-muted-foreground">Pick</TableHead>
                    <TableHead className="min-w-[250px] text-muted-foreground">Ticket</TableHead>
                    <TableHead className="text-muted-foreground">Status</TableHead>
                    <TableHead className="text-muted-foreground">Health</TableHead>
                    <TableHead className="min-w-[210px] text-muted-foreground">Goal</TableHead>
                    <TableHead className="text-muted-foreground">Assignee</TableHead>
                    <TableHead className="text-muted-foreground">Staleness</TableHead>
                    <TableHead className="text-muted-foreground">Receipts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.slice(0, 60).map((row) => {
                    const health = healthForRow(row)
                    const selected = selectedIds.includes(row.id)
                    const isStaleUnassigned =
                      !row.assignee && row.updatedHoursAgo >= 48 && row.status !== 'done'

                    return (
                      <TableRow
                        key={row.id}
                        className={selected ? 'border-white/10 bg-white/[0.04]' : 'border-white/10'}
                      >
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => {
                              setSelectedIds((current) =>
                                current.includes(row.id)
                                  ? current.filter((id) => id !== row.id)
                                  : [...current, row.id]
                              )
                            }}
                            className="h-4 w-4 rounded border-white/20 bg-black/20"
                            aria-label={`Select ticket ${row.number}`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-white">#{row.number}</span>
                              <span className="text-sm text-white/90">{row.title}</span>
                              {isStaleUnassigned ? (
                                <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-200">
                                  Top of queue
                                </Badge>
                              ) : null}
                              {row.rapidAssignHint ? (
                                <Badge className="border-white/10 bg-white/[0.04] text-white/80">
                                  Rapid assign
                                </Badge>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                              <span>{row.id}</span>
                              <span>{row.commentCount} comments</span>
                              <span>created {formatHours(row.createdHoursAgo)}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={statusBadgeClass(row.status)}>
                            {statusLabel(row.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={healthBadgeClass(health)}>{healthLabel(health)}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-white/90">
                              <IconTargetArrow className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm">{row.goal}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">{row.goalId}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {row.assignee ? (
                            <div className="space-y-1">
                              <div className="text-sm text-white/90">{row.assignee}</div>
                              <div className="text-xs text-muted-foreground">
                                {row.assigneeType === 'agent' ? 'Agent owner' : 'User owner'}
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm text-amber-200">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-sm text-white/90">
                              <IconClock className="h-4 w-4 text-muted-foreground" />
                              <span>{formatHours(row.updatedHoursAgo)}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {row.updatedHoursAgo >= 48 ? 'Stale' : 'Fresh'}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="text-sm text-white/90">{row.receiptCount} receipts</div>
                            <div className="text-xs text-muted-foreground">
                              {row.receiptCount === 0
                                ? 'No linked proof yet'
                                : 'Linked work visible'}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-black/20 p-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <IconArrowsSort className="h-4 w-4 text-muted-foreground" />
                  Rapid-fire assignment lane
                </div>
                <p className="text-sm text-muted-foreground">{selectionCoverage}</p>
              </div>
              <div className="flex flex-col gap-2 md:flex-row">
                <Select
                  value={bulkAssignee}
                  onValueChange={(value) => setBulkAssignee(value ?? '')}
                >
                  <SelectTrigger className="min-w-[220px] border-white/10 bg-black/30 text-white">
                    <SelectValue placeholder="Choose assignee" />
                  </SelectTrigger>
                  <SelectContent>
                    {assigneeOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  className="bg-white text-black hover:bg-white/90"
                  onClick={() => {
                    if (!bulkAssignee || selectedRows.length === 0) return
                    setSelectedIds([])
                  }}
                >
                  Assign selected ({selectedRows.length})
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader>
              <CardTitle className="text-sm text-white">Why this shape matches Job #4</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex gap-2">
                <IconArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p>
                  50+ ticket handling is simulated directly here with a dense 58-ticket queue and
                  combined filters.
                </p>
              </div>
              <div className="flex gap-2">
                <IconArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p>
                  Status, assignee, goal, and staleness are all first-class filters instead of
                  hidden in a secondary panel.
                </p>
              </div>
              <div className="flex gap-2">
                <IconArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p>
                  The default priority sort ranks stale unassigned tickets above everything else,
                  then blocked work, then active movement.
                </p>
              </div>
              <div className="flex gap-2">
                <IconArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p>
                  Bulk selection + inline assignee picker is the interaction shape needed to hit 5
                  assignments in under 2 minutes.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader>
              <CardTitle className="text-sm text-white">Implementation notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {implementationPlan.map((section) => {
                const Icon = section.icon
                return (
                  <div
                    key={section.title}
                    className="rounded-lg border border-white/10 bg-black/20 p-4"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-white">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      {section.title}
                    </div>
                    <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                      {section.bullets.map((bullet) => (
                        <li key={bullet} className="flex gap-2">
                          <IconArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
