'use client'

import Link from 'next/link'
import { useState, useMemo } from 'react'
import {
  IconSearch,
  IconPlus,
  IconChevronRight,
  IconFilter,
  IconSortAscending,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ChatWithAgentButton } from './[id]/ChatWithAgentButton'
import type { AgentData, AgentStatus } from './AgentsClient'

// Status indicator with pulse animation for active states
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
        {status === 'busy' && (
          <div className="absolute inset-0 animate-ping rounded-full bg-amber-400 opacity-75" />
        )}
        {status === 'idle' && (
          <div className="absolute inset-0 animate-pulse rounded-full bg-emerald-400 opacity-50" />
        )}
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
      {status.type === 'unrestricted' ? '!' : null}
      {status.label}
    </span>
  )
}

// Large, prominent avatar/emoji display
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
      {/* Subtle inner glow */}
      <div className="pointer-events-none absolute inset-0 rounded-xl shadow-[inset_0_0_12px_rgba(255,255,255,0.05)]" />
    </div>
  )
}

// Filter pill button
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
      {count !== undefined && (
        <span className={cn('ml-0.5 tabular-nums', active ? 'text-primary/70' : 'text-white/30')}>
          {count}
        </span>
      )}
    </button>
  )
}

interface AgentsTableProps {
  agents: AgentData[]
}

export function AgentsTable({ agents }: AgentsTableProps) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<AgentStatus | 'all'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'status'>('name')

  // Filter and sort agents
  const filteredAgents = useMemo(() => {
    let result = agents

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase()
      result = result.filter(
        (agent) =>
          agent.name.toLowerCase().includes(searchLower) ||
          agent.title?.toLowerCase().includes(searchLower)
      )
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((agent) => agent.status === statusFilter)
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name)
      }
      // Sort by status: busy > idle > offline
      const statusOrder = { busy: 0, idle: 1, offline: 2 }
      return statusOrder[a.status] - statusOrder[b.status]
    })

    return result
  }, [agents, search, statusFilter, sortBy])

  // Count by status
  const statusCounts = useMemo(() => {
    return agents.reduce(
      (acc, agent) => {
        acc[agent.status]++
        return acc
      },
      { idle: 0, busy: 0, offline: 0 } as Record<AgentStatus, number>
    )
  }, [agents])

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-8 py-16">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
          <span className="text-3xl">🤖</span>
        </div>
        <h3 className="text-lg font-semibold text-white/90">No agents yet</h3>
        <p className="mt-1 max-w-sm text-center text-sm text-white/50">
          Create your first agent to start processing work items and building your autonomous
          workforce.
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
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Search */}
        <div className="relative min-w-[280px] flex-1 max-w-md">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <Input
            placeholder="Search agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 border-white/10 bg-white/5 pl-9 text-sm placeholder:text-white/30 focus-visible:border-white/20 focus-visible:ring-white/10"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <IconFilter className="h-3.5 w-3.5 text-white/30" />
          <FilterPill
            active={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
            count={agents.length}
          >
            All
          </FilterPill>
          <FilterPill
            active={statusFilter === 'idle'}
            onClick={() => setStatusFilter('idle')}
            count={statusCounts.idle}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Idle
          </FilterPill>
          <FilterPill
            active={statusFilter === 'busy'}
            onClick={() => setStatusFilter('busy')}
            count={statusCounts.busy}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            Busy
          </FilterPill>
          <FilterPill
            active={statusFilter === 'offline'}
            onClick={() => setStatusFilter('offline')}
            count={statusCounts.offline}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
            Offline
          </FilterPill>
        </div>

        {/* Sort */}
        <button
          onClick={() => setSortBy(sortBy === 'name' ? 'status' : 'name')}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[0.65rem] font-medium uppercase tracking-wider text-white/50 transition hover:border-white/20 hover:bg-white/10 hover:text-white/70"
        >
          <IconSortAscending className="h-3.5 w-3.5" />
          {sortBy === 'name' ? 'Name' : 'Status'}
        </button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-transparent">
              <TableHead className="w-[50%] pl-4 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-white/40">
                Agent
              </TableHead>
              <TableHead className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-white/40">
                Status
              </TableHead>
              <TableHead className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-white/40">
                Sprite
              </TableHead>
              <TableHead className="w-[80px] pr-4 text-right text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-white/40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAgents.map((agent, index) => (
              <TableRow
                key={agent.id}
                className="group cursor-pointer border-white/5 transition-colors hover:bg-white/[0.04]"
                style={{
                  animationDelay: `${index * 30}ms`,
                }}
              >
                <TableCell className="pl-4">
                  <Link href={`/agents/${agent.id}`} className="flex items-center gap-4">
                    <AgentAvatar
                      emoji={agent.emoji}
                      avatarUrl={agent.avatarUrl}
                      name={agent.name}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-white/90 group-hover:text-white">
                          {agent.name}
                        </p>
                        <PolicyStatusBadge status={agent.policyStatus} />
                      </div>
                      <p className="truncate text-xs text-white/40">
                        {agent.title ? (
                          <>
                            {agent.title} · <span className="font-mono">@{agent.handle}</span>
                          </>
                        ) : (
                          <span className="font-mono">@{agent.handle}</span>
                        )}
                      </p>
                    </div>
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusIndicator status={agent.status} />
                </TableCell>
                <TableCell>
                  <span className="font-mono text-[0.65rem] text-white/30">
                    {agent.spriteId ? agent.spriteId.slice(0, 12) : '—'}
                  </span>
                </TableCell>
                <TableCell className="pr-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <ChatWithAgentButton agentId={agent.id} agentName={agent.name} variant="icon" />
                    <Link
                      href={`/agents/${agent.id}`}
                      className="inline-flex items-center gap-1 text-xs text-white/30 transition group-hover:text-primary"
                    >
                      Configure
                      <IconChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Results footer */}
        {filteredAgents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-white/40">No agents match your filters</p>
            <button
              onClick={() => {
                setSearch('')
                setStatusFilter('all')
              }}
              className="mt-2 text-xs text-primary hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Count */}
      <div className="flex items-center justify-between text-[0.65rem] text-white/30">
        <span>
          Showing {filteredAgents.length} of {agents.length} agents
        </span>
        {filteredAgents.length > 0 && (
          <span className="tabular-nums">
            {statusCounts.busy} active · {statusCounts.idle} idle · {statusCounts.offline} offline
          </span>
        )}
      </div>
    </div>
  )
}
