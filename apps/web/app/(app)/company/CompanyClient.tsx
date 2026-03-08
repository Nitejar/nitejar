'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  IconArrowRight,
  IconBuilding,
  IconDeviceFloppy,
  IconHierarchy,
  IconLoader2,
  IconRobot,
  IconTargetArrow,
  IconUsers,
  IconUserShield,
} from '@tabler/icons-react'
import { trpc, type RouterOutputs } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChatWithAgentButton } from '../agents/[id]/ChatWithAgentButton'
import { RelativeTime } from '../components/RelativeTime'

type CompanyOverview = RouterOutputs['company']['getOverview']
type GoalRow = CompanyOverview['goalsInProgress'][number]
type InitiativeRow = CompanyOverview['initiatives'][number]
type OrganizationRow = CompanyOverview['organization'][number]
type TeamRow = CompanyOverview['teams'][number]
type AgentRow = CompanyOverview['agents'][number]
type CompanyView = RouterOutputs['company']['listViews'][number]
type CompanyTab = 'overview' | 'organization' | 'portfolio'
type GroupBy = 'team' | 'owner' | 'health' | 'coverage' | null
type Density = 'compact' | 'comfortable'
type OwnershipStatus = 'any' | 'owned' | 'unowned'
type SortField =
  | 'priority'
  | 'title'
  | 'health'
  | 'coverage'
  | 'progress'
  | 'staffing_depth'
  | 'blocked_load'
  | 'last_activity_at'
  | 'last_heartbeat_at'

type Filters = {
  q?: string
  ownerRef?: string
  ownershipStatus?: OwnershipStatus
  teamId?: string
  health?: Array<'draft' | 'active' | 'at_risk' | 'blocked' | 'done' | 'archived'>
  coverageStatus?: Array<'covered' | 'thin' | 'unstaffed' | 'overloaded'>
  staleOnly?: boolean
  staleAgeHours?: number
  staffingDepthMax?: number
  blockedLoadMin?: number
  recentActivityHours?: number
}

type BuiltInView = {
  id: string
  name: string
  description: string
  tab: CompanyTab
  filters: Filters
  groupBy?: GroupBy
  sort?: { field: SortField; direction: 'asc' | 'desc' }
}

const BUILT_IN_VIEWS: BuiltInView[] = [
  {
    id: 'builtin:board-overview',
    name: 'Board Overview',
    description: 'Executive framing for company state before drilling into operator detail.',
    tab: 'overview',
    filters: {},
    sort: { field: 'priority', direction: 'desc' },
  },
  {
    id: 'builtin:in-progress',
    name: 'In Progress',
    description: 'All active portfolio work, sorted by management priority.',
    tab: 'portfolio',
    filters: { health: ['active', 'at_risk', 'blocked'] },
    sort: { field: 'priority', direction: 'desc' },
  },
  {
    id: 'builtin:coverage-gaps',
    name: 'Coverage Gaps',
    description: 'Thin and unstaffed goals that need staffing intervention.',
    tab: 'portfolio',
    filters: { coverageStatus: ['thin', 'unstaffed', 'overloaded'] },
    sort: { field: 'blocked_load', direction: 'desc' },
  },
  {
    id: 'builtin:blocked-portfolio',
    name: 'Blocked Portfolio',
    description: 'Blocked and at-risk goals with blocked load near the top.',
    tab: 'portfolio',
    filters: { health: ['blocked', 'at_risk'], blockedLoadMin: 10 },
    sort: { field: 'priority', direction: 'desc' },
  },
  {
    id: 'builtin:team-load',
    name: 'Team Load',
    description: 'Teams as execution units with load, staffing gaps, and heartbeat posture.',
    tab: 'organization',
    filters: {},
  },
  {
    id: 'builtin:unassigned-work',
    name: 'Unassigned Work',
    description: 'Goals missing an owner or a clear staffing path.',
    tab: 'portfolio',
    filters: { ownershipStatus: 'unowned' },
    sort: { field: 'priority', direction: 'desc' },
  },
]

const DEFAULT_FILTERS: Filters = {
  ownershipStatus: 'any',
}

function healthRank(health: GoalRow['health']) {
  if (health === 'blocked') return 0
  if (health === 'at_risk') return 1
  if (health === 'active') return 2
  if (health === 'draft') return 3
  return 4
}

function coverageRank(coverage: GoalRow['coverageStatus']) {
  if (coverage === 'unstaffed') return 0
  if (coverage === 'overloaded') return 1
  if (coverage === 'thin') return 2
  return 3
}

function normalizeFilters(input: unknown): Filters {
  const candidate = input && typeof input === 'object' ? (input as Partial<Filters>) : {}
  return {
    q: typeof candidate.q === 'string' && candidate.q.trim() ? candidate.q.trim() : undefined,
    ownerRef:
      typeof candidate.ownerRef === 'string' && candidate.ownerRef.trim()
        ? candidate.ownerRef.trim()
        : undefined,
    ownershipStatus:
      candidate.ownershipStatus === 'owned' || candidate.ownershipStatus === 'unowned'
        ? candidate.ownershipStatus
        : 'any',
    teamId:
      typeof candidate.teamId === 'string' && candidate.teamId.trim()
        ? candidate.teamId.trim()
        : undefined,
    health: Array.isArray(candidate.health) ? candidate.health : undefined,
    coverageStatus: Array.isArray(candidate.coverageStatus) ? candidate.coverageStatus : undefined,
    staleOnly: candidate.staleOnly === true,
    staleAgeHours:
      typeof candidate.staleAgeHours === 'number' && candidate.staleAgeHours > 0
        ? candidate.staleAgeHours
        : undefined,
    staffingDepthMax:
      typeof candidate.staffingDepthMax === 'number' ? candidate.staffingDepthMax : undefined,
    blockedLoadMin:
      typeof candidate.blockedLoadMin === 'number' ? candidate.blockedLoadMin : undefined,
    recentActivityHours:
      typeof candidate.recentActivityHours === 'number' && candidate.recentActivityHours > 0
        ? candidate.recentActivityHours
        : undefined,
  }
}

function StatusBadge({
  value,
  tone,
}: {
  value: string
  tone: 'health' | 'coverage' | 'workload' | 'heartbeat' | 'change'
}) {
  const label = value.replace(/_/g, ' ')
  const className =
    tone === 'health'
      ? value === 'blocked'
        ? 'border-rose-400/30 bg-rose-500/10 text-rose-300'
        : value === 'at_risk'
          ? 'border-amber-400/30 bg-amber-500/10 text-amber-300'
          : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
      : tone === 'coverage'
        ? value === 'unstaffed'
          ? 'border-rose-400/30 bg-rose-500/10 text-rose-300'
          : value === 'overloaded'
            ? 'border-orange-400/30 bg-orange-500/10 text-orange-300'
            : value === 'thin'
              ? 'border-amber-400/30 bg-amber-500/10 text-amber-300'
              : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
        : tone === 'workload'
          ? value === 'overloaded'
            ? 'border-rose-400/30 bg-rose-500/10 text-rose-300'
            : value === 'thin'
              ? 'border-amber-400/30 bg-amber-500/10 text-amber-300'
              : value === 'steady'
                ? 'border-sky-400/30 bg-sky-500/10 text-sky-300'
                : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
          : tone === 'heartbeat'
            ? value === 'missing'
              ? 'border-rose-400/30 bg-rose-500/10 text-rose-300'
              : value === 'quiet'
                ? 'border-amber-400/30 bg-amber-500/10 text-amber-300'
                : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
            : value.includes('changed') || value.includes('blocked')
              ? 'border-amber-400/30 bg-amber-500/10 text-amber-300'
              : value.includes('heartbeat')
                ? 'border-sky-400/30 bg-sky-500/10 text-sky-300'
                : 'border-white/10 bg-white/5 text-white/60'

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide',
        className
      )}
    >
      {label}
    </span>
  )
}

function ViewChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.2em] transition',
        active
          ? 'border-primary/40 bg-primary/15 text-primary'
          : 'border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:text-white/80'
      )}
    >
      {label}
    </button>
  )
}

function ActorPills({
  actors,
  max = 4,
}: {
  actors: Array<{ ref: string; label: string; emoji?: string | null }>
  max?: number
}) {
  if (actors.length === 0) {
    return <span className="text-xs text-white/35">None</span>
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actors.slice(0, max).map((actor) => (
        <span
          key={actor.ref}
          className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[0.7rem] text-white/70"
        >
          {actor.emoji ? <span>{actor.emoji}</span> : null}
          <span>{actor.label}</span>
        </span>
      ))}
      {actors.length > max ? (
        <span className="text-[0.65rem] text-white/40">+{actors.length - max}</span>
      ) : null}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  hint,
  href,
  icon: Icon,
}: {
  label: string
  value: string | number
  hint: string
  href: string
  icon: typeof IconTargetArrow
}) {
  return (
    <Link
      href={href}
      className="group flex h-full items-start justify-between gap-4 bg-white/[0.03] px-4 py-4 transition hover:bg-white/[0.05]"
    >
      <div className="min-w-0">
        <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">{label}</p>
        <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</p>
        <p className="mt-2 text-xs text-white/45">{hint}</p>
      </div>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-white/35 transition group-hover:text-white/55" />
    </Link>
  )
}

function filterGoals(goals: GoalRow[], filters: Filters) {
  const nowMs = Date.now()
  return goals.filter((goal) => {
    const query = filters.q?.toLowerCase()
    if (query) {
      const haystack = [
        goal.title,
        goal.outcome,
        goal.owner?.label ?? '',
        goal.team?.label ?? '',
        ...goal.staffedAgents.map((agent) => agent.label),
      ]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(query)) return false
    }

    if (filters.ownerRef && goal.owner?.ref !== filters.ownerRef) return false
    if (filters.ownershipStatus === 'unowned' && goal.owner) return false
    if (filters.ownershipStatus === 'owned' && !goal.owner) return false
    if (filters.teamId && goal.team?.ref !== filters.teamId) return false
    if (filters.health && filters.health.length > 0 && !filters.health.includes(goal.health))
      return false
    if (
      filters.coverageStatus &&
      filters.coverageStatus.length > 0 &&
      !filters.coverageStatus.includes(goal.coverageStatus)
    ) {
      return false
    }
    if (filters.staleOnly && !goal.isStale) return false
    if (filters.staleAgeHours && goal.lastActivityAt > 0) {
      const ageHours = Math.floor((nowMs - goal.lastActivityAt * 1000) / 3600000)
      if (ageHours < filters.staleAgeHours) return false
    }
    if (
      typeof filters.staffingDepthMax === 'number' &&
      goal.staffingDepth > filters.staffingDepthMax
    ) {
      return false
    }
    if (
      typeof filters.blockedLoadMin === 'number' &&
      goal.blockedLoadPct < filters.blockedLoadMin
    ) {
      return false
    }
    if (filters.recentActivityHours && goal.lastActivityAt > 0) {
      const ageHours = Math.floor((nowMs - goal.lastActivityAt * 1000) / 3600000)
      if (ageHours > filters.recentActivityHours) return false
    }
    return true
  })
}

function sortGoals(goals: GoalRow[], sort: { field: SortField; direction: 'asc' | 'desc' }) {
  const direction = sort.direction === 'asc' ? 1 : -1
  return [...goals].sort((a, b) => {
    let delta = 0
    switch (sort.field) {
      case 'title':
        delta = a.title.localeCompare(b.title)
        break
      case 'health':
        delta = healthRank(a.health) - healthRank(b.health)
        break
      case 'coverage':
        delta = coverageRank(a.coverageStatus) - coverageRank(b.coverageStatus)
        break
      case 'progress':
        delta = a.progressPct - b.progressPct
        break
      case 'staffing_depth':
        delta = a.staffingDepth - b.staffingDepth
        break
      case 'blocked_load':
        delta = a.blockedLoadPct - b.blockedLoadPct
        break
      case 'last_heartbeat_at':
        delta = (a.lastHeartbeatAt ?? 0) - (b.lastHeartbeatAt ?? 0)
        break
      case 'last_activity_at':
        delta = a.lastActivityAt - b.lastActivityAt
        break
      case 'priority':
      default:
        delta =
          healthRank(a.health) - healthRank(b.health) ||
          coverageRank(a.coverageStatus) - coverageRank(b.coverageStatus) ||
          b.blockedLoadPct - a.blockedLoadPct
        return delta
    }
    return delta * direction
  })
}

function groupGoals(goals: GoalRow[], groupBy: GroupBy) {
  if (!groupBy) return [{ label: 'All Goals', items: goals }]
  const groups = new Map<string, GoalRow[]>()
  for (const goal of goals) {
    const key =
      groupBy === 'team'
        ? (goal.team?.label ?? 'No Team')
        : groupBy === 'owner'
          ? (goal.owner?.label ?? 'No Owner')
          : groupBy === 'health'
            ? goal.health
            : goal.coverageStatus
    const current = groups.get(key) ?? []
    current.push(goal)
    groups.set(key, current)
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }))
}

function GoalActionDialog({
  goal,
  open,
  onOpenChange,
  teamOptions,
  userOptions,
  agentOptions,
}: {
  goal: GoalRow | null
  open: boolean
  onOpenChange: (value: boolean) => void
  teamOptions: Array<{ id: string; label: string }>
  userOptions: Array<{ id: string; label: string }>
  agentOptions: Array<{ id: string; label: string }>
}) {
  const utils = trpc.useUtils()
  const [teamId, setTeamId] = useState('')
  const [ownerKind, setOwnerKind] = useState<'user' | 'agent' | 'team' | ''>('')
  const [ownerRef, setOwnerRef] = useState('')
  const [agentId, setAgentId] = useState('')

  useEffect(() => {
    if (!goal) return
    setTeamId(goal.team?.ref ?? '')
    setOwnerKind(goal.owner?.kind ?? '')
    setOwnerRef(goal.owner?.ref ?? '')
    setAgentId('')
  }, [goal])

  const assignTeamMutation = trpc.company.assignGoalTeam.useMutation({
    onSuccess: async () => {
      await utils.company.getOverview.invalidate()
    },
  })
  const assignOwnerMutation = trpc.company.assignGoalOwner.useMutation({
    onSuccess: async () => {
      await utils.company.getOverview.invalidate()
    },
  })
  const addGoalAgentMutation = trpc.company.addGoalAgent.useMutation({
    onSuccess: async () => {
      setAgentId('')
      await utils.company.getOverview.invalidate()
    },
  })
  const removeGoalAgentMutation = trpc.company.removeGoalAgent.useMutation({
    onSuccess: async () => {
      await utils.company.getOverview.invalidate()
    },
  })

  if (!goal) return null

  const ownerChoices =
    ownerKind === 'user' ? userOptions : ownerKind === 'agent' ? agentOptions : teamOptions

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#0a0a0a] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage Staffing</DialogTitle>
          <DialogDescription>
            {goal.title}. Keep Company structural: team, owner, staffed agents, and the right
            drill-ins.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-white/10 bg-white/[0.03]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-white/90">Goal Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <div className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">Team</div>
                <div className="flex gap-2">
                  <NativeSelect value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                    <NativeSelectOption value="">No team</NativeSelectOption>
                    {teamOptions.map((team) => (
                      <NativeSelectOption key={team.id} value={team.id}>
                        {team.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Button
                    size="sm"
                    onClick={() =>
                      assignTeamMutation.mutate({
                        goalId: goal.id,
                        teamId: teamId || null,
                      })
                    }
                    disabled={assignTeamMutation.isPending}
                  >
                    Set
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">Owner</div>
                <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)_70px]">
                  <NativeSelect
                    value={ownerKind}
                    onChange={(event) => {
                      setOwnerKind(event.target.value as 'user' | 'agent' | 'team' | '')
                      setOwnerRef('')
                    }}
                  >
                    <NativeSelectOption value="">No owner</NativeSelectOption>
                    <NativeSelectOption value="user">User</NativeSelectOption>
                    <NativeSelectOption value="agent">Agent</NativeSelectOption>
                    <NativeSelectOption value="team">Team</NativeSelectOption>
                  </NativeSelect>
                  <NativeSelect
                    value={ownerRef}
                    onChange={(event) => setOwnerRef(event.target.value)}
                    disabled={!ownerKind}
                  >
                    <NativeSelectOption value="">
                      {ownerKind ? 'Select owner' : 'Choose a kind first'}
                    </NativeSelectOption>
                    {ownerChoices.map((option) => (
                      <NativeSelectOption key={option.id} value={option.id}>
                        {option.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Button
                    size="sm"
                    onClick={() =>
                      assignOwnerMutation.mutate({
                        goalId: goal.id,
                        ownerKind: ownerKind || null,
                        ownerRef: ownerRef || null,
                      })
                    }
                    disabled={assignOwnerMutation.isPending || (ownerKind !== '' && !ownerRef)}
                  >
                    Set
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <Link href={goal.receiptLinks.goal}>
                  <Button size="sm" variant="outline">
                    Goal Queue
                  </Button>
                </Link>
                <Link href={goal.receiptLinks.activity}>
                  <Button size="sm" variant="outline">
                    Activity
                  </Button>
                </Link>
                <Link href={goal.receiptLinks.costs}>
                  <Button size="sm" variant="outline">
                    Costs
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.03]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-white/90">Staffed Agents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <NativeSelect value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                  <NativeSelectOption value="">Add agent to goal coverage</NativeSelectOption>
                  {agentOptions.map((agent) => (
                    <NativeSelectOption key={agent.id} value={agent.id}>
                      {agent.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Button
                  size="sm"
                  onClick={() =>
                    addGoalAgentMutation.mutate({
                      goalId: goal.id,
                      agentId,
                    })
                  }
                  disabled={addGoalAgentMutation.isPending || !agentId}
                >
                  Add
                </Button>
              </div>

              <div className="space-y-2">
                {goal.staffedAgents.length > 0 ? (
                  goal.staffedAgents.map((agent) => (
                    <div
                      key={agent.ref}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                    >
                      <div className="flex items-center gap-2 text-sm text-white/80">
                        {agent.emoji ? <span>{agent.emoji}</span> : null}
                        <span>{agent.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <ChatWithAgentButton
                          agentId={agent.ref}
                          agentName={agent.label}
                          variant="icon"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            removeGoalAgentMutation.mutate({
                              goalId: goal.id,
                              agentId: agent.ref,
                            })
                          }
                          disabled={removeGoalAgentMutation.isPending}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-white/40">No staffed agents yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PortfolioTable({
  sections,
  onManage,
}: {
  sections: Array<{ label: string; items: GoalRow[] }>
  onManage: (goal: GoalRow) => void
}) {
  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <Card key={section.label} className="border-white/10 bg-white/[0.03]">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm text-white/90">{section.label}</CardTitle>
              <Badge variant="outline">{section.items.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="overflow-hidden rounded-2xl border border-white/10 bg-black/20 p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead>Goal</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Coverage</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Staffing</TableHead>
                  <TableHead>Queue</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Receipts</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {section.items.map((goal) => (
                  <TableRow key={goal.id} className="border-white/5">
                    <TableCell className="align-top">
                      <div className="space-y-1">
                        <Link
                          href={goal.receiptLinks.goal}
                          className="font-medium text-white/90 hover:text-primary"
                        >
                          {goal.title}
                        </Link>
                        <div className="text-[0.65rem] uppercase tracking-[0.18em] text-white/35">
                          {goal.initiative?.title ?? 'No initiative'}
                          {goal.parentGoalId ? ' · child goal' : ''}
                        </div>
                        <p className="max-w-[28rem] text-xs text-white/45">{goal.outcome}</p>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusBadge value={goal.health} tone="health" />
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusBadge value={goal.coverageStatus} tone="coverage" />
                    </TableCell>
                    <TableCell className="align-top text-xs text-white/70">
                      {goal.owner?.label ?? 'Unassigned'}
                    </TableCell>
                    <TableCell className="align-top text-xs text-white/70">
                      {goal.team?.label ?? 'No team'}
                    </TableCell>
                    <TableCell className="align-top text-xs text-white/60">
                      <div>{goal.staffingDepth} staffed agents</div>
                      <div>{goal.staffedTeams.length} active teams</div>
                    </TableCell>
                    <TableCell className="align-top text-xs text-white/60">
                      <div>{goal.openTicketCount} open</div>
                      <div>{goal.blockedTicketCount} blocked</div>
                    </TableCell>
                    <TableCell className="align-top text-xs text-white/60">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.max(goal.progressPct, 6)}%` }}
                          />
                        </div>
                        <span>{goal.progressPct}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      <div className="flex flex-col gap-1">
                        <Link
                          href={goal.receiptLinks.activity}
                          className="text-white/55 hover:text-white/80"
                        >
                          Activity
                        </Link>
                        <Link
                          href={goal.receiptLinks.costs}
                          className="text-white/55 hover:text-white/80"
                        >
                          Costs
                        </Link>
                        <Link
                          href={goal.receiptLinks.sessions}
                          className="text-white/55 hover:text-white/80"
                        >
                          Sessions
                        </Link>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <Button size="sm" variant="outline" onClick={() => onManage(goal)}>
                        Manage
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

type OrganizationBranchSnapshot = {
  goalCount: number
  queuedTicketCount: number
  staffingGapCount: number
  overloadedAgentCount: number
  teamCount: number
  teams: TeamRow[]
  initiatives: InitiativeRow[]
}

function OrganizationTreeRow({
  unit,
  depth,
  selectedUnitId,
  childrenByParent,
  branchByUnitId,
  onSelect,
}: {
  unit: OrganizationRow
  depth: number
  selectedUnitId: string
  childrenByParent: Map<string | null, OrganizationRow[]>
  branchByUnitId: Map<string, OrganizationBranchSnapshot>
  onSelect: (unitId: string) => void
}) {
  const branch = branchByUnitId.get(unit.id)
  const children = childrenByParent.get(unit.id) ?? []
  const selected = selectedUnitId === unit.id

  return (
    <div className="space-y-1">
      <button
        onClick={() => onSelect(unit.id)}
        className={cn(
          'flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition',
          selected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <span
          className={cn(
            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
            selected ? 'bg-primary' : 'bg-white/20'
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="truncate text-sm font-medium text-white/90">{unit.name}</div>
                <div className="text-[0.6rem] uppercase tracking-[0.22em] text-white/30">
                  {unit.kind}
                </div>
              </div>
              {branch ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.68rem] text-white/40">
                  <span>{branch.teamCount} teams</span>
                  <span>·</span>
                  <span>{branch.goalCount} goals</span>
                  <span>·</span>
                  <span>{branch.initiatives.length} initiatives</span>
                </div>
              ) : null}
            </div>
            {branch && branch.staffingGapCount > 0 ? (
              <Badge variant="destructive" className="shrink-0">
                {branch.staffingGapCount} gaps
              </Badge>
            ) : null}
          </div>
        </div>
      </button>
      {children.length > 0 ? (
        <div className="ml-3 space-y-1 border-l border-white/10 pl-3">
          {children.map((child) => (
            <OrganizationTreeRow
              key={child.id}
              unit={child}
              depth={depth + 1}
              selectedUnitId={selectedUnitId}
              childrenByParent={childrenByParent}
              branchByUnitId={branchByUnitId}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function OrganizationDetailPanel({
  unit,
  parent,
  children,
  branch,
}: {
  unit: OrganizationRow
  parent: OrganizationRow | null
  children: OrganizationRow[]
  branch: OrganizationBranchSnapshot
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="text-[0.65rem] uppercase tracking-[0.28em] text-white/35">
          {parent ? `${parent.name} / ${unit.kind}` : unit.kind}
        </div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-white">{unit.name}</h3>
            <p className="mt-2 max-w-3xl text-sm text-white/50">
              {unit.description ?? 'No description yet.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {unit.owner ? <Badge variant="outline">{unit.owner.label}</Badge> : null}
            {parent ? <Badge variant="outline">Reports to {parent.name}</Badge> : null}
          </div>
        </div>
      </div>

      <div className="grid gap-px border-b border-white/10 bg-white/10 md:grid-cols-4">
        <div className="bg-white/[0.03] px-5 py-4">
          <div className="text-[0.6rem] uppercase tracking-[0.22em] text-white/35">Teams</div>
          <div className="mt-2 text-2xl font-semibold text-white">{branch.teamCount}</div>
        </div>
        <div className="bg-white/[0.03] px-5 py-4">
          <div className="text-[0.6rem] uppercase tracking-[0.22em] text-white/35">Goals</div>
          <div className="mt-2 text-2xl font-semibold text-white">{branch.goalCount}</div>
        </div>
        <div className="bg-white/[0.03] px-5 py-4">
          <div className="text-[0.6rem] uppercase tracking-[0.22em] text-white/35">Ticket Load</div>
          <div className="mt-2 text-2xl font-semibold text-white">{branch.queuedTicketCount}</div>
        </div>
        <div className="bg-white/[0.03] px-5 py-4">
          <div className="text-[0.6rem] uppercase tracking-[0.22em] text-white/35">
            Staffing Risk
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="text-2xl font-semibold text-white">{branch.staffingGapCount}</div>
            {branch.overloadedAgentCount > 0 ? (
              <span className="text-xs text-white/45">
                {branch.overloadedAgentCount} overloaded agents
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="space-y-6">
          <div>
            <div className="text-[0.65rem] uppercase tracking-[0.22em] text-white/35">
              Execution Teams
            </div>
            <div className="mt-3 divide-y divide-white/10 rounded-xl border border-white/10 bg-black/15">
              {branch.teams.length > 0 ? (
                branch.teams.map((team) => (
                  <div
                    key={team.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white/90">{team.name}</div>
                      <div className="mt-1 text-xs text-white/45">
                        {team.activeGoalCount} goals · {team.queuedTicketCount} queued ·{' '}
                        {team.members.length} members · {team.agents.length} agents
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge value={team.heartbeatPosture} tone="heartbeat" />
                      {team.goalsNeedingStaffingCount > 0 ? (
                        <Badge variant="destructive">{team.goalsNeedingStaffingCount} gaps</Badge>
                      ) : (
                        <Badge variant="outline">covered</Badge>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-3 text-sm text-white/35">No teams roll up here yet.</div>
              )}
            </div>
          </div>

          <div>
            <div className="text-[0.65rem] uppercase tracking-[0.22em] text-white/35">
              Initiatives In This Branch
            </div>
            <div className="mt-3 divide-y divide-white/10 rounded-xl border border-white/10 bg-black/15">
              {branch.initiatives.length > 0 ? (
                branch.initiatives.map((initiative) => (
                  <div
                    key={initiative.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white/90">{initiative.title}</div>
                      <div className="mt-1 text-xs text-white/45">
                        {initiative.goalCount} goals · {initiative.staffingGapCount} staffing gaps ·{' '}
                        {initiative.targetLabel ?? 'No target'}
                      </div>
                    </div>
                    <StatusBadge value={initiative.status} tone="health" />
                  </div>
                ))
              ) : (
                <div className="px-4 py-3 text-sm text-white/35">
                  No initiatives have been tied to this branch yet.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <div className="text-[0.65rem] uppercase tracking-[0.22em] text-white/35">
              Reporting Line
            </div>
            <div className="mt-3 space-y-3 rounded-xl border border-white/10 bg-black/15 p-4">
              {parent ? (
                <div className="space-y-2">
                  <div className="text-[0.6rem] uppercase tracking-[0.22em] text-white/35">
                    Reports up
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/75">
                    {parent.name}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-white/45">Top of the organization.</div>
              )}
              <div className="border-l border-white/10 pl-4">
                <div className="text-[0.6rem] uppercase tracking-[0.22em] text-white/35">
                  Current
                </div>
                <div className="mt-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-white">
                  {unit.name}
                </div>
              </div>
              <div className="space-y-2 border-l border-white/10 pl-4">
                <div className="text-[0.6rem] uppercase tracking-[0.22em] text-white/35">
                  Reports down
                </div>
                {children.length > 0 ? (
                  children.map((child) => (
                    <div
                      key={child.id}
                      className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/75"
                    >
                      {child.name}
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-white/35">No child units beneath this node.</div>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="text-[0.65rem] uppercase tracking-[0.22em] text-white/35">Receipts</div>
            <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-black/15 p-4 text-sm">
              <Link
                href="/work"
                className="flex items-center justify-between text-white/70 hover:text-white"
              >
                <span>Open work for this branch</span>
                <IconArrowRight className="h-4 w-4 text-white/35" />
              </Link>
              <Link
                href="/agents"
                className="flex items-center justify-between text-white/70 hover:text-white"
              >
                <span>Inspect the agents carrying this load</span>
                <IconArrowRight className="h-4 w-4 text-white/35" />
              </Link>
              <Link
                href="/activity"
                className="flex items-center justify-between text-white/70 hover:text-white"
              >
                <span>Read the recent execution trail</span>
                <IconArrowRight className="h-4 w-4 text-white/35" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AgentCard({ agent }: { agent: AgentRow }) {
  return (
    <Card className="border-white/10 bg-white/[0.03]">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base text-white/90">
              {agent.actor?.label ?? 'Unknown agent'}
            </CardTitle>
            <p className="mt-1 text-xs text-white/45">
              {agent.primaryTeam?.label ?? 'No primary team'} · impact {agent.portfolioImpactScore}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge value={agent.workloadSignal} tone="workload" />
            <ChatWithAgentButton agentId={agent.id} agentName={agent.actor?.label} variant="icon" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        <div className="grid grid-cols-2 gap-2 text-white/60">
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <div className="text-[0.6rem] uppercase tracking-[0.25em] text-white/35">Goals</div>
            <div className="mt-2 font-medium text-white/80">{agent.goals.length}</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <div className="text-[0.6rem] uppercase tracking-[0.25em] text-white/35">Tickets</div>
            <div className="mt-2 font-medium text-white/80">{agent.openTicketCount}</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <div className="text-[0.6rem] uppercase tracking-[0.25em] text-white/35">Blocked</div>
            <div className="mt-2 font-medium text-white/80">{agent.blockedTicketCount}</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <div className="text-[0.6rem] uppercase tracking-[0.25em] text-white/35">Sessions</div>
            <div className="mt-2 font-medium text-white/80">{agent.activeSessionCount}</div>
          </div>
        </div>
        <div>
          <div className="mb-2 text-[0.6rem] uppercase tracking-[0.25em] text-white/35">
            Portfolio Support
          </div>
          <div className="space-y-2">
            {agent.goals.length > 0 ? (
              agent.goals.slice(0, 5).map((goal) => (
                <div
                  key={goal.id}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
                >
                  <Link
                    href={`/work/goals/${goal.id}`}
                    className="truncate text-white/80 hover:text-white"
                  >
                    {goal.title}
                  </Link>
                  <StatusBadge value={goal.coverageStatus} tone="coverage" />
                </div>
              ))
            ) : (
              <span className="text-white/35">No portfolio assignments right now.</span>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-white/10 pt-3 text-white/45">
          <span>
            {agent.lastActivityAt ? (
              <RelativeTime timestamp={agent.lastActivityAt} />
            ) : (
              'No recent ticket activity'
            )}
          </span>
          <div className="flex gap-3">
            <Link href={agent.receiptLinks.agent} className="hover:text-white/80">
              Agent
            </Link>
            <Link href={agent.receiptLinks.work} className="hover:text-white/80">
              Work
            </Link>
            <Link href={agent.receiptLinks.costs} className="hover:text-white/80">
              Costs
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function StaffingMatrix({
  goals,
  agents,
  teams,
  density,
  collapsedTeams,
  onToggleTeam,
  onManage,
}: {
  goals: GoalRow[]
  agents: AgentRow[]
  teams: TeamRow[]
  density: Density
  collapsedTeams: string[]
  onToggleTeam: (teamId: string) => void
  onManage: (goal: GoalRow) => void
}) {
  const agentGroups = teams
    .map((team) => ({
      team,
      agents: agents.filter(
        (agent) =>
          agent.primaryTeam?.ref === team.id || agent.teams.some((entry) => entry.ref === team.id)
      ),
    }))
    .filter((group) => group.agents.length > 0)

  const visibleGroups = agentGroups.filter((group) => !collapsedTeams.includes(group.team.id))
  const cellPadding = density === 'compact' ? 'px-2 py-2' : 'px-3 py-3'

  function cellState(goal: GoalRow, agent: AgentRow) {
    const isOwner = goal.owner?.kind === 'agent' && goal.owner.ref === agent.id
    const isAllocated = goal.allocatedAgents.some((entry) => entry.ref === agent.id)
    const isStaffed = goal.staffedAgents.some((entry) => entry.ref === agent.id)
    if (isOwner) return 'owner'
    if (isAllocated) return 'allocated'
    if (isStaffed) return agent.workloadSignal === 'overloaded' ? 'overloaded' : 'staffed'
    return ''
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {agentGroups.map((group) => (
          <button
            key={group.team.id}
            onClick={() => onToggleTeam(group.team.id)}
            className={cn(
              'rounded-full border px-3 py-1 text-[0.65rem] uppercase tracking-[0.2em] transition',
              collapsedTeams.includes(group.team.id)
                ? 'border-white/10 bg-white/5 text-white/45'
                : 'border-primary/30 bg-primary/10 text-primary'
            )}
          >
            {collapsedTeams.includes(group.team.id) ? 'Show' : 'Hide'} {group.team.name}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03]">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-transparent">
              <TableHead className="min-w-[280px]">Goal</TableHead>
              {visibleGroups.map((group) => (
                <TableHead
                  key={group.team.id}
                  colSpan={group.agents.length}
                  className="text-center"
                >
                  {group.team.name}
                </TableHead>
              ))}
            </TableRow>
            <TableRow className="border-white/10 hover:bg-transparent">
              <TableHead>Coverage</TableHead>
              {visibleGroups.flatMap((group) =>
                group.agents.map((agent) => (
                  <TableHead key={agent.id} className="min-w-[100px] text-center">
                    <div className="space-y-1">
                      <div className="text-[0.7rem] text-white/75">
                        {agent.actor?.label ?? 'Agent'}
                      </div>
                      <StatusBadge value={agent.workloadSignal} tone="workload" />
                    </div>
                  </TableHead>
                ))
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {goals.map((goal) => (
              <TableRow key={goal.id} className="border-white/5">
                <TableCell className={cn('align-top', cellPadding)}>
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link
                          href={goal.receiptLinks.goal}
                          className="font-medium text-white/90 hover:text-primary"
                        >
                          {goal.title}
                        </Link>
                        <p className="mt-1 text-xs text-white/45">
                          {goal.team?.label ?? 'No team'} · {goal.openTicketCount} open
                        </p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => onManage(goal)}>
                        Manage
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge value={goal.health} tone="health" />
                      <StatusBadge value={goal.coverageStatus} tone="coverage" />
                    </div>
                  </div>
                </TableCell>
                {visibleGroups.flatMap((group) =>
                  group.agents.map((agent) => {
                    const state = cellState(goal, agent)
                    return (
                      <TableCell
                        key={`${goal.id}:${agent.id}`}
                        className={cn('align-middle text-center', cellPadding)}
                      >
                        <div
                          className={cn(
                            'mx-auto flex h-8 w-8 items-center justify-center rounded-lg border text-[0.6rem] font-semibold uppercase',
                            state === 'owner'
                              ? 'border-sky-400/40 bg-sky-500/15 text-sky-300'
                              : state === 'allocated'
                                ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                                : state === 'overloaded'
                                  ? 'border-rose-400/40 bg-rose-500/15 text-rose-300'
                                  : state === 'staffed'
                                    ? 'border-white/20 bg-white/10 text-white/80'
                                    : 'border-white/10 bg-white/[0.03] text-white/20'
                          )}
                        >
                          {state === 'owner'
                            ? 'O'
                            : state === 'allocated'
                              ? 'A'
                              : state === 'overloaded'
                                ? '!'
                                : state === 'staffed'
                                  ? 'S'
                                  : ''}
                        </div>
                      </TableCell>
                    )
                  })
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-white/45">
        <span>O = owner</span>
        <span>A = direct allocation</span>
        <span>S = staffed through active work</span>
        <span>! = staffed but overloaded</span>
      </div>
    </div>
  )
}

export function CompanyClient() {
  const overviewQuery = trpc.company.getOverview.useQuery(undefined, {
    refetchInterval: 15_000,
  })
  const viewsQuery = trpc.company.listViews.useQuery()
  const membersQuery = trpc.org.listMembers.useQuery()
  const teamsQuery = trpc.org.listTeams.useQuery()
  const orgAgentsQuery = trpc.org.listAgents.useQuery()

  const upsertViewMutation = trpc.company.upsertView.useMutation({
    onSuccess: async () => {
      await viewsQuery.refetch()
    },
  })
  const deleteViewMutation = trpc.company.deleteView.useMutation({
    onSuccess: async () => {
      await viewsQuery.refetch()
    },
  })

  const [activeTab, setActiveTab] = useState<CompanyTab>('overview')
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [sort, setSort] = useState<{ field: SortField; direction: 'asc' | 'desc' }>({
    field: 'priority',
    direction: 'desc',
  })
  const [groupBy, setGroupBy] = useState<GroupBy>(null)
  const [selectedViewId, setSelectedViewId] = useState<string | null>('builtin:board-overview')
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveViewName, setSaveViewName] = useState('')
  const [selectedGoal, setSelectedGoal] = useState<GoalRow | null>(null)
  const [goalDialogOpen, setGoalDialogOpen] = useState(false)
  const [density, setDensity] = useState<Density>('comfortable')
  const [collapsedTeams, setCollapsedTeams] = useState<string[]>([])
  const [selectedOrganizationUnitId, setSelectedOrganizationUnitId] = useState<string | null>(null)

  const data = overviewQuery.data
  const organizationData = data?.organization ?? []
  const initiativeData = data?.initiatives ?? []
  const teamData = data?.teams ?? []
  const savedViews = useMemo(() => viewsQuery.data ?? [], [viewsQuery.data])
  const selectedSavedView = useMemo(
    () => savedViews.find((view) => view.id === selectedViewId) ?? null,
    [savedViews, selectedViewId]
  )

  const teamOptions = useMemo(
    () => (teamsQuery.data ?? []).map((team) => ({ id: team.id, label: team.name })),
    [teamsQuery.data]
  )
  const userOptions = useMemo(
    () => (membersQuery.data ?? []).map((member) => ({ id: member.id, label: member.name })),
    [membersQuery.data]
  )
  const agentOptions = useMemo(
    () => (orgAgentsQuery.data ?? []).map((agent) => ({ id: agent.id, label: agent.name })),
    [orgAgentsQuery.data]
  )

  const filteredGoals = useMemo(() => {
    if (!data) return []
    return sortGoals(filterGoals(data.goalsInProgress, filters), sort)
  }, [data, filters, sort])

  const groupedGoals = useMemo(() => groupGoals(filteredGoals, groupBy), [filteredGoals, groupBy])
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, OrganizationRow[]>()
    for (const unit of organizationData) {
      const key = unit.parentOrgUnitId ?? null
      const group = map.get(key) ?? []
      group.push(unit)
      map.set(key, group)
    }
    return map
  }, [organizationData])
  const organizationById = useMemo(
    () => new Map(organizationData.map((unit) => [unit.id, unit])),
    [organizationData]
  )
  const branchByUnitId = useMemo(() => {
    const map = new Map<string, OrganizationBranchSnapshot>()

    const collect = (unit: OrganizationRow): OrganizationBranchSnapshot => {
      const childUnits = childrenByParent.get(unit.id) ?? []
      const teamIds = new Set(unit.teams.map((team) => team.id))

      for (const child of childUnits) {
        const childBranch = collect(child)
        for (const team of childBranch.teams) {
          teamIds.add(team.id)
        }
      }

      const teams = teamData.filter((team) => teamIds.has(team.id))
      const initiatives = initiativeData.filter(
        (initiative) => initiative.team?.ref && teamIds.has(initiative.team.ref)
      )
      const snapshot = {
        teamCount: teams.length,
        teams,
        initiatives,
        goalCount: teams.reduce((sum, team) => sum + team.activeGoalCount, 0),
        queuedTicketCount: teams.reduce((sum, team) => sum + team.queuedTicketCount, 0),
        staffingGapCount: teams.reduce((sum, team) => sum + team.goalsNeedingStaffingCount, 0),
        overloadedAgentCount: teams.reduce((sum, team) => sum + team.overloadedAgentCount, 0),
      }
      map.set(unit.id, snapshot)
      return snapshot
    }

    for (const root of childrenByParent.get(null) ?? []) {
      collect(root)
    }

    return map
  }, [childrenByParent, initiativeData, teamData])
  const rootOrganizationUnits = useMemo(() => childrenByParent.get(null) ?? [], [childrenByParent])
  const selectedOrganizationUnit =
    (selectedOrganizationUnitId ? organizationById.get(selectedOrganizationUnitId) : null) ??
    rootOrganizationUnits[0] ??
    organizationData[0]
  const selectedOrganizationParent = selectedOrganizationUnit?.parentOrgUnitId
    ? (organizationById.get(selectedOrganizationUnit.parentOrgUnitId) ?? null)
    : null
  const selectedOrganizationChildren = selectedOrganizationUnit
    ? (childrenByParent.get(selectedOrganizationUnit.id) ?? [])
    : []
  const selectedOrganizationBranch = selectedOrganizationUnit
    ? (branchByUnitId.get(selectedOrganizationUnit.id) ?? {
        teamCount: 0,
        teams: [],
        initiatives: [],
        goalCount: 0,
        queuedTicketCount: 0,
        staffingGapCount: 0,
        overloadedAgentCount: 0,
      })
    : null

  useEffect(() => {
    if (!selectedOrganizationUnitId && rootOrganizationUnits[0]) {
      setSelectedOrganizationUnitId(rootOrganizationUnits[0].id)
      return
    }

    if (selectedOrganizationUnitId && !organizationById.has(selectedOrganizationUnitId)) {
      setSelectedOrganizationUnitId(rootOrganizationUnits[0]?.id ?? organizationData[0]?.id ?? null)
    }
  }, [organizationById, organizationData, rootOrganizationUnits, selectedOrganizationUnitId])

  function applyBuiltInView(view: BuiltInView) {
    setActiveTab(view.tab)
    setFilters(normalizeFilters(view.filters))
    setSort(view.sort ?? { field: 'priority', direction: 'desc' })
    setGroupBy(view.groupBy ?? null)
    setSelectedViewId(view.id)
  }

  function applySavedView(view: CompanyView) {
    setActiveTab('portfolio')
    setFilters(normalizeFilters(view.filters))
    setSort(
      view.sort && typeof view.sort === 'object' && 'field' in view.sort && 'direction' in view.sort
        ? (view.sort as { field: SortField; direction: 'asc' | 'desc' })
        : { field: 'priority', direction: 'desc' }
    )
    setGroupBy((view.groupBy as GroupBy) ?? null)
    setSelectedViewId(view.id)
  }

  function handleSaveView() {
    upsertViewMutation.mutate({
      viewId: selectedSavedView?.id,
      view: {
        entityKind: 'company',
        name: saveViewName.trim() || selectedSavedView?.name || 'Company view',
        filters,
        sort,
        groupBy,
      },
    })
    setSaveDialogOpen(false)
    setSaveViewName('')
  }

  function openManageDialog(goal: GoalRow) {
    setSelectedGoal(goal)
    setGoalDialogOpen(true)
  }

  function toggleCollapsedTeam(teamId: string) {
    setCollapsedTeams((current) =>
      current.includes(teamId) ? current.filter((value) => value !== teamId) : [...current, teamId]
    )
  }

  if (overviewQuery.isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="border-white/10 bg-white/[0.03]">
        <CardContent className="grid gap-6 p-6 xl:grid-cols-[1.6fr_1fr]">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.35em] text-white/35">
              <IconBuilding className="h-3.5 w-3.5" />
              Board Framing
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                {data.board.headline}
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-white/55">{data.board.subhead}</p>
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-white/50">
              <Link href="/work" className="hover:text-white/80">
                Work
              </Link>
              <Link href="/agents" className="hover:text-white/80">
                Agents
              </Link>
              <Link href="/activity" className="hover:text-white/80">
                Activity
              </Link>
              <Link href="/costs" className="hover:text-white/80">
                Costs
              </Link>
              <Link href="/sessions" className="hover:text-white/80">
                Sessions
              </Link>
            </div>
          </div>
          <div className="space-y-3">
            {data.board.interventions.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/75 hover:border-white/20 hover:bg-black/30"
              >
                <span>{item.label}</span>
                <IconArrowRight className="h-4 w-4 text-white/35" />
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Active Goals"
          value={data.summary.active_goal_count}
          hint="What the company is doing now."
          href="/company"
          icon={IconTargetArrow}
        />
        <SummaryCard
          label="Coverage Gaps"
          value={data.summary.unstaffed_goal_count + data.summary.thin_goal_count}
          hint="Thin, overloaded, or missing staffing."
          href="/company"
          icon={IconUsers}
        />
        <SummaryCard
          label="Ownership Open"
          value={data.summary.ownership_open_count}
          hint="Goals without a clear owner."
          href="/company"
          icon={IconUserShield}
        />
        <SummaryCard
          label="Idle Capacity"
          value={data.summary.idle_agent_count}
          hint="Agents that can pick up portfolio load."
          href="/agents"
          icon={IconRobot}
        />
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as CompanyTab)}
        className="space-y-4"
      >
        <TabsList variant="line" className="border-b border-white/10 pb-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
            <Card className="border-white/10 bg-white/[0.03]">
              <CardHeader>
                <CardTitle className="text-base text-white/90">What Needs Intervention</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.coverageGaps.map((goal) => (
                  <div
                    key={goal.id}
                    className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={goal.receiptLinks.goal}
                          className="font-medium text-white/90 hover:text-primary"
                        >
                          {goal.title}
                        </Link>
                        <p className="mt-1 text-xs text-white/45">
                          {goal.team?.label ?? 'No team'} · {goal.owner?.label ?? 'No owner'} ·{' '}
                          {goal.openTicketCount} open
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge value={goal.health} tone="health" />
                        <StatusBadge value={goal.coverageStatus} tone="coverage" />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => openManageDialog(goal)}>
                        Staffing Action
                      </Button>
                      <Link href={goal.receiptLinks.activity}>
                        <Button size="sm" variant="outline">
                          Activity
                        </Button>
                      </Link>
                      <Link href={goal.receiptLinks.goal}>
                        <Button size="sm" variant="outline">
                          Goal Queue
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="border-white/10 bg-white/[0.03]">
                <CardHeader>
                  <CardTitle className="text-base text-white/90">Team Load</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.teams.slice(0, 6).map((team) => (
                    <div
                      key={team.id}
                      className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-white/90">{team.name}</p>
                          <p className="mt-1 text-xs text-white/45">
                            {team.ownedGoalCount} owned goals · {team.queuedTicketCount} queued
                            tickets
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge value={team.heartbeatPosture} tone="heartbeat" />
                          <Badge
                            variant={team.goalsNeedingStaffingCount > 0 ? 'destructive' : 'outline'}
                          >
                            {team.goalsNeedingStaffingCount} gaps
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-white/[0.03]">
                <CardHeader>
                  <CardTitle className="text-base text-white/90">Initiative Ladder</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.initiatives.slice(0, 4).map((initiative) => (
                    <div
                      key={initiative.id}
                      className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-white/90">{initiative.title}</p>
                          <p className="mt-1 text-xs text-white/45">
                            {initiative.goalCount} goals · {initiative.staffingGapCount} staffing
                            gaps · {initiative.targetLabel ?? 'No target'}
                          </p>
                        </div>
                        <StatusBadge value={initiative.status} tone="health" />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-white/[0.03]">
                <CardHeader>
                  <CardTitle className="text-base text-white/90">Management Change Feed</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.recentChanges.slice(0, 10).map((change) => (
                    <div
                      key={change.id}
                      className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <StatusBadge value={change.kind} tone="change" />
                          <span className="text-xs text-white/70">
                            {change.goal?.title ?? change.team?.name ?? 'Company'}
                          </span>
                        </div>
                        <span className="text-[0.65rem] text-white/40">
                          <RelativeTime timestamp={change.createdAt} />
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-white/55">{change.body}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="organization" className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-white/90">Organization Map</h3>
            <p className="text-sm text-white/45">
              Read this as a reporting line. Pick a branch on the left, then inspect the teams,
              initiatives, and staffing pressure underneath it.
            </p>
          </div>
          <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
              <div className="border-b border-white/10 px-4 py-3">
                <div className="text-[0.65rem] uppercase tracking-[0.24em] text-white/35">
                  Hierarchy
                </div>
              </div>
              <div className="space-y-2 p-3">
                {rootOrganizationUnits.map((unit) => (
                  <OrganizationTreeRow
                    key={unit.id}
                    unit={unit}
                    depth={0}
                    selectedUnitId={selectedOrganizationUnit?.id ?? unit.id}
                    childrenByParent={childrenByParent}
                    branchByUnitId={branchByUnitId}
                    onSelect={setSelectedOrganizationUnitId}
                  />
                ))}
              </div>
            </div>

            {selectedOrganizationUnit && selectedOrganizationBranch ? (
              <OrganizationDetailPanel
                unit={selectedOrganizationUnit}
                parent={selectedOrganizationParent}
                children={selectedOrganizationChildren}
                branch={selectedOrganizationBranch}
              />
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="portfolio" className="space-y-4">
          <Card className="border-white/10 bg-white/[0.03]">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-sm">Company Views</CardTitle>
                  <p className="mt-1 text-sm text-white/45">
                    Large portfolios stay manageable here. The structure stays primary; advanced
                    filters and saved views are available when you need them.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSaveDialogOpen(true)}>
                    <IconDeviceFloppy className="h-3.5 w-3.5" />
                    {selectedSavedView ? 'Save Changes' : 'Save View'}
                  </Button>
                  {selectedSavedView ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        deleteViewMutation.mutate(
                          { viewId: selectedSavedView.id },
                          { onSuccess: () => setSelectedViewId(null) }
                        )
                      }
                      disabled={deleteViewMutation.isPending}
                    >
                      Delete View
                    </Button>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {BUILT_IN_VIEWS.map((view) => (
                    <ViewChip
                      key={view.id}
                      label={view.name}
                      active={selectedViewId === view.id}
                      onClick={() => applyBuiltInView(view)}
                    />
                  ))}
                </div>
                {savedViews.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                      Saved
                    </span>
                    {savedViews.map((view) => (
                      <ViewChip
                        key={view.id}
                        label={view.name}
                        active={selectedViewId === view.id}
                        onClick={() => applySavedView(view)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_180px_180px_160px_160px_170px]">
                <Input
                  value={filters.q ?? ''}
                  onChange={(event) => {
                    setFilters((current) => ({ ...current, q: event.target.value || undefined }))
                    setSelectedViewId(null)
                  }}
                  placeholder="Search goals, owners, teams, staffed agents"
                />
                <NativeSelect
                  value={filters.teamId ?? ''}
                  onChange={(event) => {
                    setFilters((current) => ({
                      ...current,
                      teamId: event.target.value || undefined,
                    }))
                    setSelectedViewId(null)
                  }}
                >
                  <NativeSelectOption value="">All teams</NativeSelectOption>
                  {teamOptions.map((team) => (
                    <NativeSelectOption key={team.id} value={team.id}>
                      {team.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <NativeSelect
                  value={filters.ownershipStatus ?? 'any'}
                  onChange={(event) => {
                    setFilters((current) => ({
                      ...current,
                      ownershipStatus: event.target.value as OwnershipStatus,
                    }))
                    setSelectedViewId(null)
                  }}
                >
                  <NativeSelectOption value="any">Any ownership</NativeSelectOption>
                  <NativeSelectOption value="owned">Owned</NativeSelectOption>
                  <NativeSelectOption value="unowned">Unowned</NativeSelectOption>
                </NativeSelect>
                <NativeSelect
                  value={(filters.coverageStatus?.[0] ?? '') as string}
                  onChange={(event) => {
                    setFilters((current) => ({
                      ...current,
                      coverageStatus: event.target.value
                        ? [event.target.value as GoalRow['coverageStatus']]
                        : undefined,
                    }))
                    setSelectedViewId(null)
                  }}
                >
                  <NativeSelectOption value="">All coverage</NativeSelectOption>
                  <NativeSelectOption value="covered">Covered</NativeSelectOption>
                  <NativeSelectOption value="thin">Thin</NativeSelectOption>
                  <NativeSelectOption value="unstaffed">Unstaffed</NativeSelectOption>
                  <NativeSelectOption value="overloaded">Overloaded</NativeSelectOption>
                </NativeSelect>
                <NativeSelect
                  value={String(filters.staffingDepthMax ?? '')}
                  onChange={(event) => {
                    setFilters((current) => ({
                      ...current,
                      staffingDepthMax: event.target.value ? Number(event.target.value) : undefined,
                    }))
                    setSelectedViewId(null)
                  }}
                >
                  <NativeSelectOption value="">Any staffing depth</NativeSelectOption>
                  <NativeSelectOption value="0">0 agents</NativeSelectOption>
                  <NativeSelectOption value="1">1 or fewer</NativeSelectOption>
                  <NativeSelectOption value="2">2 or fewer</NativeSelectOption>
                </NativeSelect>
                <NativeSelect
                  value={String(filters.blockedLoadMin ?? '')}
                  onChange={(event) => {
                    setFilters((current) => ({
                      ...current,
                      blockedLoadMin: event.target.value ? Number(event.target.value) : undefined,
                    }))
                    setSelectedViewId(null)
                  }}
                >
                  <NativeSelectOption value="">Any blocked load</NativeSelectOption>
                  <NativeSelectOption value="10">10%+</NativeSelectOption>
                  <NativeSelectOption value="25">25%+</NativeSelectOption>
                  <NativeSelectOption value="50">50%+</NativeSelectOption>
                </NativeSelect>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <NativeSelect
                  value={`${sort.field}:${sort.direction}`}
                  onChange={(event) => {
                    const [field, direction] = event.target.value.split(':') as [
                      SortField,
                      'asc' | 'desc',
                    ]
                    setSort({ field, direction })
                    setSelectedViewId(null)
                  }}
                >
                  <NativeSelectOption value="priority:desc">Priority</NativeSelectOption>
                  <NativeSelectOption value="last_activity_at:desc">
                    Recent activity
                  </NativeSelectOption>
                  <NativeSelectOption value="blocked_load:desc">Blocked load</NativeSelectOption>
                  <NativeSelectOption value="staffing_depth:asc">Staffing depth</NativeSelectOption>
                  <NativeSelectOption value="title:asc">Title A-Z</NativeSelectOption>
                </NativeSelect>
                <NativeSelect
                  value={groupBy ?? ''}
                  onChange={(event) => {
                    setGroupBy((event.target.value as GroupBy) || null)
                    setSelectedViewId(null)
                  }}
                >
                  <NativeSelectOption value="">No grouping</NativeSelectOption>
                  <NativeSelectOption value="team">Group by team</NativeSelectOption>
                  <NativeSelectOption value="owner">Group by owner</NativeSelectOption>
                  <NativeSelectOption value="health">Group by health</NativeSelectOption>
                  <NativeSelectOption value="coverage">Group by coverage</NativeSelectOption>
                </NativeSelect>
                <NativeSelect
                  value={String(filters.recentActivityHours ?? '')}
                  onChange={(event) => {
                    setFilters((current) => ({
                      ...current,
                      recentActivityHours: event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    }))
                    setSelectedViewId(null)
                  }}
                >
                  <NativeSelectOption value="">Any recent activity</NativeSelectOption>
                  <NativeSelectOption value="24">Last 24h</NativeSelectOption>
                  <NativeSelectOption value="72">Last 72h</NativeSelectOption>
                  <NativeSelectOption value="168">Last 7d</NativeSelectOption>
                </NativeSelect>
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/50">
                  <span>{filteredGoals.length} goals in view</span>
                  <span>
                    {selectedSavedView
                      ? `Saved: ${selectedSavedView.name}`
                      : (BUILT_IN_VIEWS.find((view) => view.id === selectedViewId)?.description ??
                        'Unsaved view')}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <PortfolioTable sections={groupedGoals} onManage={openManageDialog} />
          <Card className="border-white/10 bg-white/[0.03]">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-sm">Staffing Matrix</CardTitle>
                  <p className="mt-1 text-sm text-white/45">
                    Goals on the left. Agent groups across the top. Keep coverage, thin staffing,
                    overload, and idle capacity legible.
                  </p>
                </div>
                <NativeSelect
                  value={density}
                  onChange={(event) => setDensity(event.target.value as Density)}
                  className="w-[160px]"
                >
                  <NativeSelectOption value="compact">Compact</NativeSelectOption>
                  <NativeSelectOption value="comfortable">Comfortable</NativeSelectOption>
                </NativeSelect>
              </div>
            </CardHeader>
            <CardContent>
              <StaffingMatrix
                goals={filteredGoals}
                agents={data.agents}
                teams={data.teams}
                density={density}
                collapsedTeams={collapsedTeams}
                onToggleTeam={toggleCollapsedTeam}
                onManage={openManageDialog}
              />
            </CardContent>
          </Card>
          <Card className="border-white/10 bg-white/[0.03]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Agent Allocation</CardTitle>
              <p className="mt-1 text-sm text-white/45">
                Agents stay subordinate to the portfolio here: who supports what, where capacity is
                thin, and where intervention is needed.
              </p>
            </CardHeader>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {data.agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/45">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-2">
            <IconHierarchy className="h-3.5 w-3.5" />
            Company is structural: portfolio, staffing, and management interventions.
          </span>
          <span>
            Command Center stays the attention surface. Work stays the queue and ticket surface.
            Sessions remain one click away without becoming the only way to understand the company.
          </span>
        </div>
      </div>

      <GoalActionDialog
        goal={selectedGoal}
        open={goalDialogOpen}
        onOpenChange={setGoalDialogOpen}
        teamOptions={teamOptions}
        userOptions={userOptions}
        agentOptions={agentOptions}
      />

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="border-white/10 bg-[#0a0a0a] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedSavedView ? 'Update Company View' : 'Save Company View'}
            </DialogTitle>
            <DialogDescription>
              Persist the current portfolio filters, sorting, and grouping.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={saveViewName}
            onChange={(event) => setSaveViewName(event.target.value)}
            placeholder={selectedSavedView?.name ?? 'Coverage Gaps'}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveView} disabled={upsertViewMutation.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
