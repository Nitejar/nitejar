'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  IconCheck,
  IconChevronRight,
  IconFilter,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
  IconArrowRight,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'
import { RelativeTime } from '../components/RelativeTime'
import { ChatWithAgentButton } from './[id]/ChatWithAgentButton'
import type { AgentData, AgentStatus } from './AgentsClient'

type BuiltInView = 'all' | 'busy' | 'overloaded' | 'idle' | 'high_spend'
type GroupBy = 'none' | 'team' | 'status'
type SortBy = 'name' | 'workload' | 'cost' | 'last_active'

function StatusIndicator({ status }: { status: AgentStatus }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <div
          className={cn(
            'h-2 w-2 rounded-full',
            status === 'busy' && 'bg-amber-400',
            status === 'idle' && 'bg-emerald-400',
            status === 'offline' && 'bg-zinc-500'
          )}
        />
        {status === 'busy' ? (
          <div className="absolute inset-0 animate-ping rounded-full bg-amber-400 opacity-75" />
        ) : null}
      </div>
      <span
        className={cn(
          'text-[0.65rem] font-medium uppercase tracking-wider',
          status === 'busy' && 'text-amber-400',
          status === 'idle' && 'text-emerald-400',
          status === 'offline' && 'text-zinc-500'
        )}
      >
        {status}
      </span>
    </div>
  )
}

function AgentAvatar({
  emoji,
  avatarUrl,
  name,
}: {
  emoji: string | null
  avatarUrl: string | null
  name: string
}) {
  const initials = name
    .split(/[-_\s]/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-gradient-to-br from-white/10 to-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
      ) : emoji ? (
        <span className="text-lg leading-none">{emoji}</span>
      ) : (
        <span className="text-[10px] font-semibold text-white/60">{initials}</span>
      )}
    </div>
  )
}

function FilterPill({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  count?: number
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[0.65rem] font-medium uppercase tracking-wider transition-all',
        active
          ? 'border-primary/40 bg-primary/15 text-primary'
          : 'border-zinc-800 bg-white/5 text-white/50 hover:border-zinc-700 hover:bg-white/10 hover:text-white/70'
      )}
    >
      {children}
      {count !== undefined ? (
        <span className={cn('ml-0.5 tabular-nums', active ? 'text-primary/70' : 'text-white/30')}>
          {count}
        </span>
      ) : null}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Agent detail panel (right side)
// ---------------------------------------------------------------------------

function AgentDetailPanel({ agent, onClose }: { agent: AgentData; onClose: () => void }) {
  const totalWork = agent.openTicketCount + agent.blockedTicketCount + agent.inProgressTicketCount
  const completedRecent = agent.recentDoneTicketCount

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <AgentAvatar emoji={agent.emoji} avatarUrl={agent.avatarUrl} name={agent.name} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-zinc-100">{agent.name}</h2>
            {agent.roleName && <p className="truncate text-xs text-zinc-500">{agent.roleName}</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-zinc-500 hover:text-white transition"
        >
          <IconX className="h-3.5 w-3.5" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-5 p-4">
          {/* Properties grid */}
          <div className="grid grid-cols-[90px_1fr] gap-y-2.5 text-sm">
            <span className="text-zinc-500">Status</span>
            <StatusIndicator status={agent.status} />

            <span className="text-zinc-500">Team</span>
            <span className="text-zinc-300">
              {agent.teamNames.length > 0 ? agent.teamNames.join(', ') : 'No team'}
            </span>

            <span className="text-zinc-500">Network</span>
            <span
              className={cn(
                'text-zinc-300',
                agent.policyStatus.type === 'unrestricted' && 'text-amber-400',
                agent.policyStatus.type === 'none' && 'text-zinc-500'
              )}
            >
              {agent.policyStatus.label}
            </span>

            <span className="text-zinc-500">30d spend</span>
            <span className="text-zinc-300 tabular-nums">${agent.spend30dUsd.toFixed(2)}</span>

            {agent.lastActiveAt && (
              <>
                <span className="text-zinc-500">Last active</span>
                <span className="text-zinc-400 text-xs">
                  <RelativeTime timestamp={agent.lastActiveAt} />
                </span>
              </>
            )}
          </div>

          {/* Workload */}
          <div>
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-2">
              Workload
            </h3>
            {totalWork > 0 || completedRecent > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                <Link
                  href={`/tickets?assignee=${agent.id}&view=active`}
                  className="border border-zinc-800 px-3 py-2 transition hover:border-zinc-700 hover:bg-white/[0.02]"
                >
                  <p className="text-lg font-semibold tabular-nums text-zinc-100">
                    {agent.openTicketCount}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Open tickets</p>
                </Link>
                <Link
                  href={`/tickets?assignee=${agent.id}&view=active`}
                  className="border border-zinc-800 px-3 py-2 transition hover:border-zinc-700 hover:bg-white/[0.02]"
                >
                  <p className="text-lg font-semibold tabular-nums text-zinc-100">
                    {agent.inProgressTicketCount}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">In progress</p>
                </Link>
                <Link
                  href={`/tickets?assignee=${agent.id}&view=blocked`}
                  className="border border-zinc-800 px-3 py-2 transition hover:border-zinc-700 hover:bg-white/[0.02]"
                >
                  <p className="text-lg font-semibold tabular-nums text-zinc-100">
                    {agent.blockedTicketCount}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Blocked</p>
                </Link>
                <div className="border border-zinc-800 px-3 py-2">
                  <p className="text-lg font-semibold tabular-nums text-zinc-100">
                    {completedRecent}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                    Done (recent)
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-600">No active work.</p>
            )}
            {agent.overloaded && (
              <Badge variant="destructive" className="mt-2 text-[10px] px-1.5 py-0">
                overloaded
              </Badge>
            )}
          </div>

          {/* Goals */}
          {(agent.openGoalCount > 0 || agent.ownedGoalCount > 0) && (
            <div>
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-2">
                Goals
              </h3>
              <div className="flex items-center gap-4 text-sm text-zinc-400">
                <Link
                  href={`/goals?owner=${agent.id}`}
                  className="tabular-nums hover:text-white transition-colors hover:underline"
                >
                  {agent.openGoalCount} open
                </Link>
                <Link
                  href={`/goals?owner=${agent.id}`}
                  className="tabular-nums hover:text-white transition-colors hover:underline"
                >
                  {agent.ownedGoalCount} owned
                </Link>
              </div>
            </div>
          )}

          {/* Runs & evals */}
          {(agent.runCount > 0 || agent.totalEvals > 0) && (
            <div>
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-2">
                Activity
              </h3>
              <div className="flex items-center gap-4 text-sm text-zinc-400">
                {agent.runCount > 0 && (
                  <span className="tabular-nums">
                    {agent.runCount} runs
                    {agent.failedCount > 0 && (
                      <span className="text-red-400"> ({agent.failedCount} failed)</span>
                    )}
                  </span>
                )}
                {agent.totalEvals > 0 && agent.avgEvalScore != null && (
                  <span className="tabular-nums">
                    {agent.avgEvalScore.toFixed(1)} avg eval ({agent.totalEvals})
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <ChatWithAgentButton agentId={agent.id} agentName={agent.name} />
            <Link
              href={`/agents/${agent.id}`}
              className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-white transition"
            >
              View full profile <IconArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main table
// ---------------------------------------------------------------------------

interface AgentsTableProps {
  agents: AgentData[]
  teams: { id: string; name: string }[]
}

export function AgentsTable({ agents, teams }: AgentsTableProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [view, setView] = useState<BuiltInView>('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('team')
  const [sortBy, setSortBy] = useState<SortBy>('workload')
  const [teamPopoverAgentId, setTeamPopoverAgentId] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)

  const assignTeam = trpc.org.assignAgentToTeam.useMutation({
    onSuccess: () => {
      setTeamPopoverAgentId(null)
      router.refresh()
    },
    onError: () => {
      toast.error('Failed to assign team')
    },
  })
  const unassignTeams = trpc.org.unassignAgentFromAllTeams.useMutation({
    onSuccess: () => {
      setTeamPopoverAgentId(null)
      router.refresh()
    },
    onError: () => {
      toast.error('Failed to unassign teams')
    },
  })
  const deleteAgentMutation = trpc.org.deleteAgentPermanently.useMutation({
    onSuccess: () => {
      toast.success('Agent deleted')
      router.refresh()
    },
    onError: () => {
      toast.error('Failed to delete agent')
    },
  })

  const counts = useMemo(
    () => ({
      busy: agents.filter((agent) => agent.status === 'busy').length,
      overloaded: agents.filter((agent) => agent.overloaded).length,
      idle: agents.filter((agent) => agent.status === 'idle').length,
      highSpend: agents.filter((agent) => agent.spend30dUsd >= 10).length,
    }),
    [agents]
  )

  const filteredAgents = useMemo(() => {
    let result = agents

    if (search.trim()) {
      const query = search.trim().toLowerCase()
      result = result.filter(
        (agent) =>
          agent.name.toLowerCase().includes(query) ||
          agent.handle.toLowerCase().includes(query) ||
          agent.roleName?.toLowerCase().includes(query) ||
          agent.teamNames.some((team) => team.toLowerCase().includes(query))
      )
    }

    if (view === 'busy') {
      result = result.filter((agent) => agent.status === 'busy')
    } else if (view === 'overloaded') {
      result = result.filter((agent) => agent.overloaded)
    } else if (view === 'idle') {
      result = result.filter((agent) => agent.status === 'idle')
    } else if (view === 'high_spend') {
      result = result.filter((agent) => agent.spend30dUsd >= 10)
    }

    return [...result].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'cost') return b.spend30dUsd - a.spend30dUsd
      if (sortBy === 'last_active') return (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0)
      const workloadA = a.openTicketCount * 3 + a.blockedTicketCount * 2 + a.openGoalCount
      const workloadB = b.openTicketCount * 3 + b.blockedTicketCount * 2 + b.openGoalCount
      return workloadB - workloadA
    })
  }, [agents, search, sortBy, view])

  const groupedAgents = useMemo(() => {
    const groups = new Map<string, AgentData[]>()

    for (const agent of filteredAgents) {
      const label =
        groupBy === 'none'
          ? 'All agents'
          : groupBy === 'status'
            ? agent.status
            : (agent.primaryTeam ?? 'No team')
      const current = groups.get(label) ?? []
      current.push(agent)
      groups.set(label, current)
    }

    return [...groups.entries()]
  }, [filteredAgents, groupBy])

  // Flat list for keyboard navigation (preserves group ordering)
  const flatAgents = useMemo(() => groupedAgents.flatMap(([, group]) => group), [groupedAgents])

  const selectedAgent = useMemo(
    () => (selectedAgentId ? (agents.find((a) => a.id === selectedAgentId) ?? null) : null),
    [agents, selectedAgentId]
  )

  // Scroll selected row into view
  const selectedRowRef = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedAgentId])

  // Keyboard navigation: j/k to move, Enter to open, Escape to deselect
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        const currentIdx = flatAgents.findIndex((a) => a.id === selectedAgentId)
        let nextIdx: number
        if (e.key === 'j') {
          nextIdx = currentIdx < flatAgents.length - 1 ? currentIdx + 1 : currentIdx
        } else {
          nextIdx = currentIdx > 0 ? currentIdx - 1 : 0
        }
        const next = flatAgents[nextIdx]
        if (next) setSelectedAgentId(next.id)
      } else if (e.key === 'Escape') {
        setSelectedAgentId(null)
      } else if (e.key === 'Enter' && selectedAgentId) {
        e.preventDefault()
        router.push(`/agents/${selectedAgentId}`)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [flatAgents, selectedAgentId, router])

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center border border-dashed border-zinc-800 px-8 py-16">
        <div className="mb-4 flex h-16 w-16 items-center justify-center border border-zinc-800 bg-white/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/nitejar-plain.png"
            alt=""
            className="h-12 w-12 opacity-20"
            aria-hidden="true"
          />
        </div>
        <h3 className="text-lg font-semibold text-white/90">No agents yet</h3>
        <p className="mt-1 max-w-sm text-center text-sm text-white/50">
          Create your first agent to start processing work and building your fleet.
        </p>
        <Link
          href="/agents/new"
          className="mt-6 inline-flex items-center gap-2 border border-primary/40 bg-primary/15 px-4 py-2.5 text-sm font-medium text-primary transition hover:border-primary/60 hover:bg-primary/25"
        >
          <IconPlus className="h-4 w-4" />
          Create Agent
        </Link>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 gap-0">
      {/* Left: table area */}
      <div
        className={cn(
          'min-w-0 flex-1 space-y-4 overflow-y-auto',
          selectedAgentId ? 'hidden lg:block' : ''
        )}
      >
        <div className="flex items-center gap-2">
          <div className="relative min-w-[200px] max-w-xs flex-1">
            <IconSearch className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
            <Input
              placeholder="Search agents or teams"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-7 border-zinc-800 bg-white/5 pl-8 text-xs placeholder:text-white/30"
            />
          </div>

          <div className="flex-1" />

          <Popover>
            <PopoverTrigger
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition',
                view !== 'all' || groupBy !== 'team' || sortBy !== 'workload'
                  ? 'border-white/20 bg-white/[0.06] text-white'
                  : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
              )}
            >
              <IconFilter className="h-3 w-3" />
              Filter
              {(view !== 'all' || groupBy !== 'team' || sortBy !== 'workload') && (
                <span className="inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-white/15 px-1 text-[9px] font-medium text-white">
                  {(view !== 'all' ? 1 : 0) +
                    (groupBy !== 'team' ? 1 : 0) +
                    (sortBy !== 'workload' ? 1 : 0)}
                </span>
              )}
            </PopoverTrigger>
            <PopoverContent className="w-64 space-y-3 p-3" align="end">
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  Status
                </label>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <FilterPill
                    active={view === 'all'}
                    onClick={() => setView('all')}
                    count={agents.length}
                  >
                    All
                  </FilterPill>
                  <FilterPill
                    active={view === 'busy'}
                    onClick={() => setView('busy')}
                    count={counts.busy}
                  >
                    Busy
                  </FilterPill>
                  <FilterPill
                    active={view === 'overloaded'}
                    onClick={() => setView('overloaded')}
                    count={counts.overloaded}
                  >
                    Overloaded
                  </FilterPill>
                  <FilterPill
                    active={view === 'idle'}
                    onClick={() => setView('idle')}
                    count={counts.idle}
                  >
                    Idle
                  </FilterPill>
                  <FilterPill
                    active={view === 'high_spend'}
                    onClick={() => setView('high_spend')}
                    count={counts.highSpend}
                  >
                    High Spend
                  </FilterPill>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  Group By
                </label>
                <NativeSelect
                  value={groupBy}
                  onChange={(event) => setGroupBy(event.target.value as GroupBy)}
                  className="mt-1 h-7 w-full text-xs"
                >
                  <NativeSelectOption value="team">Team</NativeSelectOption>
                  <NativeSelectOption value="status">Status</NativeSelectOption>
                  <NativeSelectOption value="none">No grouping</NativeSelectOption>
                </NativeSelect>
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  Sort By
                </label>
                <NativeSelect
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortBy)}
                  className="mt-1 h-7 w-full text-xs"
                >
                  <NativeSelectOption value="workload">Workload</NativeSelectOption>
                  <NativeSelectOption value="cost">Cost</NativeSelectOption>
                  <NativeSelectOption value="last_active">Last Active</NativeSelectOption>
                  <NativeSelectOption value="name">Name</NativeSelectOption>
                </NativeSelect>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Breadcrumb context line */}
        <div className="flex items-center gap-1 text-xs text-zinc-500">
          <span
            className={cn(
              'transition-colors',
              view !== 'all' || groupBy !== 'team'
                ? 'cursor-pointer hover:text-white'
                : 'text-zinc-400'
            )}
            onClick={() => {
              setView('all')
              setGroupBy('team')
              setSortBy('workload')
              setSearch('')
            }}
          >
            Agents
          </span>
          {groupBy !== 'none' && (
            <>
              <span className="text-zinc-600"> · </span>
              <span className="text-zinc-400">By {groupBy}</span>
            </>
          )}
          {view !== 'all' && (
            <>
              <span className="text-zinc-600"> · </span>
              <span
                className="cursor-pointer hover:text-white transition-colors"
                onClick={() => setView('all')}
              >
                {view === 'busy'
                  ? 'Busy only'
                  : view === 'overloaded'
                    ? 'Overloaded only'
                    : view === 'idle'
                      ? 'Idle only'
                      : 'High spend'}
              </span>
            </>
          )}
          {search && (
            <>
              <span className="text-zinc-600"> · </span>
              <span
                className="cursor-pointer hover:text-white transition-colors"
                onClick={() => setSearch('')}
              >
                Search: &quot;{search}&quot;
              </span>
            </>
          )}
        </div>

        {groupedAgents.map(([label, group]) => (
          <div key={label} className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {label}
              </p>
              <p className="text-xs text-muted-foreground">{group.length} agents</p>
            </div>

            <div className="overflow-hidden border border-zinc-800">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800">
                    <TableHead className="pl-4 text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Agent
                    </TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Status
                    </TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Workload
                    </TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                      30d Cost
                    </TableHead>
                    <TableHead className="pr-4 text-right text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.map((agent) => (
                    <TableRow
                      key={agent.id}
                      ref={agent.id === selectedAgentId ? selectedRowRef : undefined}
                      className={cn(
                        'border-zinc-800 cursor-pointer transition',
                        agent.id === selectedAgentId
                          ? 'bg-white/[0.08] ring-1 ring-inset ring-white/10'
                          : 'hover:bg-white/[0.03]'
                      )}
                      onClick={() =>
                        setSelectedAgentId(agent.id === selectedAgentId ? null : agent.id)
                      }
                    >
                      <TableCell className="py-3 pl-4">
                        <div className="flex items-center gap-3">
                          <AgentAvatar
                            emoji={agent.emoji}
                            avatarUrl={agent.avatarUrl}
                            name={agent.name}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/agents/${agent.id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-sm font-medium text-white hover:underline"
                              >
                                {agent.name}
                              </Link>
                              {agent.overloaded ? (
                                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                  overloaded
                                </Badge>
                              ) : null}
                            </div>
                            <Popover
                              open={teamPopoverAgentId === agent.id}
                              onOpenChange={(open) => setTeamPopoverAgentId(open ? agent.id : null)}
                            >
                              <PopoverTrigger className="mt-0.5 text-xs text-muted-foreground hover:text-white/70 transition-colors text-left">
                                {agent.teamNames.length > 0
                                  ? agent.teamNames.join(', ')
                                  : 'No team'}
                              </PopoverTrigger>
                              <PopoverContent className="w-48 p-1" align="start" sideOffset={4}>
                                <div className="max-h-48 overflow-y-auto">
                                  <button
                                    className={cn(
                                      'flex w-full items-center gap-2 px-2 py-1.5 text-xs transition-colors hover:bg-white/[0.06]',
                                      agent.teamNames.length === 0
                                        ? 'text-white'
                                        : 'text-muted-foreground'
                                    )}
                                    disabled={unassignTeams.isPending}
                                    onClick={() => unassignTeams.mutate({ agentId: agent.id })}
                                  >
                                    {agent.teamNames.length === 0 && (
                                      <IconCheck className="h-3 w-3 shrink-0" />
                                    )}
                                    <span className={agent.teamNames.length === 0 ? '' : 'pl-5'}>
                                      No team
                                    </span>
                                  </button>
                                  {teams.map((team) => {
                                    const isSelected = agent.teamNames.includes(team.name)
                                    return (
                                      <button
                                        key={team.id}
                                        className={cn(
                                          'flex w-full items-center gap-2 px-2 py-1.5 text-xs transition-colors hover:bg-white/[0.06]',
                                          isSelected ? 'text-white' : 'text-muted-foreground'
                                        )}
                                        disabled={assignTeam.isPending}
                                        onClick={() =>
                                          assignTeam.mutate({
                                            teamId: team.id,
                                            agentId: agent.id,
                                          })
                                        }
                                      >
                                        {isSelected && <IconCheck className="h-3 w-3 shrink-0" />}
                                        <span className={isSelected ? '' : 'pl-5'}>
                                          {team.name}
                                        </span>
                                      </button>
                                    )
                                  })}
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <StatusIndicator status={agent.status} />
                      </TableCell>
                      <TableCell className="py-3">
                        <span className="text-sm tabular-nums text-white/80">
                          {agent.openTicketCount === 0 && agent.blockedTicketCount === 0 ? (
                            <span className="text-muted-foreground">No active work</span>
                          ) : (
                            <>
                              {agent.openTicketCount} open
                              {agent.blockedTicketCount > 0 ? (
                                <span className="text-muted-foreground">
                                  {' '}
                                  &middot; {agent.blockedTicketCount} blocked
                                </span>
                              ) : null}
                            </>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="py-3 text-sm tabular-nums text-white/80">
                        ${agent.spend30dUsd.toFixed(2)}
                      </TableCell>
                      <TableCell className="py-3 pr-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <div onClick={(e) => e.stopPropagation()}>
                            <ChatWithAgentButton
                              agentId={agent.id}
                              agentName={agent.name}
                              variant="icon"
                            />
                          </div>
                          <button
                            className="inline-flex h-7 w-7 items-center justify-center rounded border border-zinc-800 bg-white/5 text-white/30 transition hover:border-red-800 hover:bg-red-500/10 hover:text-red-400"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (
                                window.confirm(
                                  `Remove agent "${agent.name}"? This cannot be undone.`
                                )
                              ) {
                                deleteAgentMutation.mutate({ agentId: agent.id })
                              }
                            }}
                          >
                            <IconTrash className="h-3.5 w-3.5" />
                          </button>
                          <Link
                            href={`/agents/${agent.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex h-7 w-7 items-center justify-center rounded border border-zinc-800 bg-white/5 text-white/50 transition hover:border-zinc-700 hover:bg-white/10 hover:text-white/70"
                          >
                            <IconChevronRight className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ))}
      </div>

      {/* Right: detail panel */}
      {selectedAgent && (
        <div className="flex min-h-0 w-full animate-in fade-in slide-in-from-right-2 duration-200 ease-out flex-col border-l border-zinc-800 lg:w-[400px]">
          <AgentDetailPanel agent={selectedAgent} onClose={() => setSelectedAgentId(null)} />
        </div>
      )}
    </div>
  )
}
