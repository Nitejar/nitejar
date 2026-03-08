'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  IconChevronRight,
  IconFilter,
  IconPlus,
  IconSearch,
  IconSortAscending,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
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
import { RelativeTime } from '../components/RelativeTime'
import { ChatWithAgentButton } from './[id]/ChatWithAgentButton'
import type { AgentData, AgentStatus } from './AgentsClient'

type BuiltInView = 'all' | 'busy' | 'overloaded' | 'idle' | 'high_spend'
type GroupBy = 'none' | 'team' | 'status'
type SortBy = 'name' | 'workload' | 'cost' | 'quality' | 'last_active'

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
    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
      ) : emoji ? (
        <span className="text-xl leading-none">{emoji}</span>
      ) : (
        <span className="text-xs font-semibold text-white/60">{initials}</span>
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
          : 'border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:bg-white/10 hover:text-white/70'
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

function PolicyStatusBadge({ status }: { status: AgentData['policyStatus'] }) {
  const styles = {
    unrestricted: 'border-amber-400/30 bg-amber-500/10 text-amber-300',
    preset: 'border-blue-400/30 bg-blue-500/10 text-blue-300',
    custom: 'border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-300',
    none: 'border-white/10 bg-white/5 text-white/40',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide',
        styles[status.type]
      )}
    >
      {status.label}
    </span>
  )
}

function workloadLabel(agent: AgentData) {
  if (agent.openTicketCount === 0 && agent.openGoalCount === 0) return 'No active work'
  return `${agent.openTicketCount} tickets · ${agent.openGoalCount} goals`
}

function qualityLabel(agent: AgentData) {
  if (agent.avgEvalScore == null || agent.totalEvals === 0) return 'No evals'
  return `${Math.round(agent.avgEvalScore * 100)}% across ${agent.totalEvals} evals`
}

interface AgentsTableProps {
  agents: AgentData[]
}

export function AgentsTable({ agents }: AgentsTableProps) {
  const [search, setSearch] = useState('')
  const [view, setView] = useState<BuiltInView>('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('team')
  const [sortBy, setSortBy] = useState<SortBy>('workload')

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
          agent.title?.toLowerCase().includes(query) ||
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
      if (sortBy === 'quality') return (b.avgEvalScore ?? -1) - (a.avgEvalScore ?? -1)
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

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-8 py-16">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
          <span className="text-3xl">🤖</span>
        </div>
        <h3 className="text-lg font-semibold text-white/90">No agents yet</h3>
        <p className="mt-1 max-w-sm text-center text-sm text-white/50">
          Create your first agent to start processing work and building your fleet.
        </p>
        <Link
          href="/agents/new"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/15 px-4 py-2.5 text-sm font-medium text-primary transition hover:border-primary/60 hover:bg-primary/25"
        >
          <IconPlus className="h-4 w-4" />
          Create Agent
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="relative min-w-[280px] max-w-md flex-1">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <Input
            placeholder="Search agents, roles, or teams"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 border-white/10 bg-white/5 pl-9 text-sm placeholder:text-white/30"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <IconFilter className="h-3.5 w-3.5 text-white/30" />
          <FilterPill active={view === 'all'} onClick={() => setView('all')} count={agents.length}>
            All
          </FilterPill>
          <FilterPill active={view === 'busy'} onClick={() => setView('busy')} count={counts.busy}>
            Busy
          </FilterPill>
          <FilterPill
            active={view === 'overloaded'}
            onClick={() => setView('overloaded')}
            count={counts.overloaded}
          >
            Overloaded
          </FilterPill>
          <FilterPill active={view === 'idle'} onClick={() => setView('idle')} count={counts.idle}>
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

        <div className="flex items-center gap-2">
          <NativeSelect
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as GroupBy)}
          >
            <NativeSelectOption value="team">Group by team</NativeSelectOption>
            <NativeSelectOption value="status">Group by status</NativeSelectOption>
            <NativeSelectOption value="none">No grouping</NativeSelectOption>
          </NativeSelect>
          <button
            onClick={() =>
              setSortBy((current) =>
                current === 'workload'
                  ? 'cost'
                  : current === 'cost'
                    ? 'quality'
                    : current === 'quality'
                      ? 'last_active'
                      : current === 'last_active'
                        ? 'name'
                        : 'workload'
              )
            }
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[0.65rem] font-medium uppercase tracking-wider text-white/50 transition hover:border-white/20 hover:bg-white/10 hover:text-white/70"
          >
            <IconSortAscending className="h-3.5 w-3.5" />
            {sortBy.replace(/_/g, ' ')}
          </button>
        </div>
      </div>

      {groupedAgents.map(([label, group]) => (
        <div key={label} className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {label}
            </p>
            <p className="text-xs text-muted-foreground">{group.length} agents</p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10">
                  <TableHead className="pl-4 text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Agent
                  </TableHead>
                  <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Team
                  </TableHead>
                  <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Workload
                  </TableHead>
                  <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Goals
                  </TableHead>
                  <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                    30d Cost
                  </TableHead>
                  <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Quality
                  </TableHead>
                  <TableHead className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Last Active
                  </TableHead>
                  <TableHead className="pr-4 text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.map((agent) => (
                  <TableRow key={agent.id} className="border-white/10">
                    <TableCell className="w-[26%] max-w-0 pl-4 align-top whitespace-normal">
                      <div className="flex items-start gap-3">
                        <AgentAvatar
                          emoji={agent.emoji}
                          avatarUrl={agent.avatarUrl}
                          name={agent.name}
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/agents/${agent.id}`}
                              className="font-medium text-white hover:underline"
                            >
                              {agent.name}
                            </Link>
                            {agent.overloaded ? (
                              <Badge variant="destructive">overloaded</Badge>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">@{agent.handle}</span>
                            {agent.title ? <span>{agent.title}</span> : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <StatusIndicator status={agent.status} />
                            <PolicyStatusBadge status={agent.policyStatus} />
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="align-top whitespace-normal text-sm text-muted-foreground">
                      {agent.teamNames.length > 0 ? agent.teamNames.join(', ') : 'No team'}
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      <div className="space-y-1 text-sm">
                        <div>{workloadLabel(agent)}</div>
                        <div className="text-xs text-muted-foreground">
                          {agent.inProgressTicketCount} in progress · {agent.blockedTicketCount}{' '}
                          blocked · {agent.recentDoneTicketCount} done recently
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="align-top whitespace-normal text-sm text-muted-foreground">
                      <div>{agent.openGoalCount} open</div>
                      <div>{agent.ownedGoalCount} owned total</div>
                    </TableCell>
                    <TableCell className="align-top whitespace-normal text-sm tabular-nums">
                      ${agent.spend30dUsd.toFixed(2)}
                    </TableCell>
                    <TableCell className="align-top whitespace-normal text-sm text-muted-foreground">
                      {qualityLabel(agent)}
                    </TableCell>
                    <TableCell className="align-top whitespace-normal text-xs text-muted-foreground">
                      {agent.lastActiveAt ? (
                        <RelativeTime timestamp={agent.lastActiveAt} />
                      ) : (
                        'No recent activity'
                      )}
                    </TableCell>
                    <TableCell className="pr-4 align-top">
                      <div className="flex items-center gap-2">
                        <ChatWithAgentButton
                          agentId={agent.id}
                          agentName={agent.name}
                          variant="icon"
                        />
                        <Link
                          href={`/agents/${agent.id}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/50 transition hover:border-white/20 hover:bg-white/10 hover:text-white/70"
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
  )
}
