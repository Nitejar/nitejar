'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { formatCost, cn } from '@/lib/utils'
import { parseAgentIdentityConfig } from '@/lib/agent-config-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import {
  IconRobot,
  IconActivity,
  IconPlayerPlay,
  IconClock,
  IconCurrencyDollar,
  IconHourglass,
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconArrowUp,
  IconArrowDown,
  IconChevronDown,
  IconChevronUp,
} from '@tabler/icons-react'
import { ChatWithAgentButton } from '../agents/[id]/ChatWithAgentButton'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarGroup,
  AvatarGroupCount,
} from '@/components/ui/avatar'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period = 'today' | '7d' | '30d' | 'all'

type SortKey = 'status' | 'name' | 'runCount' | 'successRate' | 'avgScore' | 'cost' | 'lastActiveAt'

type SortDir = 'asc' | 'desc'

// ---------------------------------------------------------------------------
// Sparkline (pure SVG)
// ---------------------------------------------------------------------------

function Sparkline({
  data,
  width = 120,
  height = 32,
}: {
  data: number[]
  width?: number
  height?: number
}) {
  if (data.length < 2) {
    return (
      <svg width={width} height={height} className="text-muted-foreground/30">
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      </svg>
    )
  }
  const max = Math.max(...data, 1)
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * width},${height - (v / max) * (height - 4) - 2}`)
    .join(' ')
  return (
    <svg width={width} height={height} className="text-primary">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Agent Avatar (reuse pattern from activity page)
// ---------------------------------------------------------------------------

function AgentAvatar({
  emoji,
  avatarUrl,
  name,
  size = 'sm',
}: {
  emoji: string | null
  avatarUrl: string | null
  name: string
  size?: 'sm' | 'md'
}) {
  const initials = name
    .split(/[-_\s]/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const sizeClass = size === 'md' ? 'h-7 w-7 text-sm' : 'h-5 w-5 text-[0.5rem]'

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] font-medium text-white/60 ${sizeClass}`}
      title={name}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={name} className="h-full w-full rounded-full object-cover" />
      ) : emoji ? (
        <span className={size === 'md' ? 'text-sm' : 'text-[0.6rem]'}>{emoji}</span>
      ) : (
        initials
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return '--'
  const nowMs = Date.now()
  const diff = nowMs - timestamp * 1000
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  if (seconds > 10) return `${seconds}s ago`
  return 'now'
}

function formatDurationTimer(startedAt: number | null, nowSeconds: number): string {
  if (!startedAt) return 'queued'
  const elapsed = nowSeconds - startedAt
  if (elapsed < 0) return '0s'
  const mins = Math.floor(elapsed / 60)
  const secs = Math.floor(elapsed % 60)
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

function formatAvgDuration(seconds: number | null): string {
  if (seconds === null || seconds === 0) return '--'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}m ${secs}s`
}

// ---------------------------------------------------------------------------
// Period Selector
// ---------------------------------------------------------------------------

const periodOptions: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
]

function PeriodSelector({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex gap-1">
      {periodOptions.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded-md px-3 py-1 text-xs font-medium transition-all',
            value === opt.value
              ? 'bg-white/10 text-white'
              : 'text-white/40 hover:bg-white/5 hover:text-white/70'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary Cards Row
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  icon: Icon,
  tint,
}: {
  label: string
  value: string
  icon: typeof IconRobot
  tint?: 'green' | 'amber' | null
}) {
  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="flex flex-row items-center justify-between pb-1">
        <CardTitle className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </CardTitle>
        <Icon
          className={cn(
            'h-4 w-4',
            tint === 'green'
              ? 'text-emerald-400'
              : tint === 'amber'
                ? 'text-amber-400'
                : 'text-muted-foreground'
          )}
        />
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Agent Roster Table
// ---------------------------------------------------------------------------

function SortableHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
  className,
}: {
  label: string
  sortKey: SortKey
  currentSort: SortKey
  currentDir: SortDir
  onSort: (key: SortKey) => void
  className?: string
}) {
  const isActive = currentSort === sortKey
  return (
    <TableHead
      className={cn('cursor-pointer select-none', className)}
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        <span>{label}</span>
        {isActive &&
          (currentDir === 'asc' ? (
            <IconArrowUp className="h-3 w-3" />
          ) : (
            <IconArrowDown className="h-3 w-3" />
          ))}
      </div>
    </TableHead>
  )
}

// ---------------------------------------------------------------------------
// Active Operations Panel
// ---------------------------------------------------------------------------

function ActiveOperationsPanel({
  operations,
}: {
  operations: Array<{
    dispatchId: string
    agentId: string
    agentName: string
    agentConfig: string | null
    status: string
    title: string
    source: string
    startedAt: number | null
    createdAt: number
  }>
}) {
  const [ticker, setTicker] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => setTicker((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  const nowSeconds = Math.floor(Date.now() / 1000)
  const running = operations.filter((op) => op.status === 'running')
  const queued = operations.filter((op) => op.status === 'queued')
  const visibleRunning = running.slice(0, 15)
  const runningOverflow = running.length - 15
  const visibleQueued = queued.slice(0, 5)
  const queuedOverflow = queued.length - 5

  // Suppress unused var warning for ticker (used to force re-render)
  void ticker

  const sourceColors: Record<string, string> = {
    telegram: 'bg-sky-500/20 text-sky-300',
    github: 'bg-purple-500/20 text-purple-300',
    manual: 'bg-white/10 text-white/50',
    scheduler: 'bg-amber-500/20 text-amber-300',
  }

  if (operations.length === 0) {
    return (
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Active Operations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
            <IconClock className="mb-2 h-6 w-6 opacity-40" />
            <p className="text-xs">No active operations</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          Active Operations
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {running.length} running
            {queued.length > 0 && `, ${queued.length} queued`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {visibleRunning.map((op) => {
          const config = parseAgentIdentityConfig(op.agentConfig)
          return (
            <div
              key={op.dispatchId}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.03]"
            >
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-blue-400" />
              <AgentAvatar
                emoji={config.emoji ?? null}
                avatarUrl={config.avatarUrl ?? null}
                name={op.agentName}
              />
              <span className="min-w-0 flex-1 truncate text-xs text-white/70">{op.title}</span>
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[0.55rem]',
                  sourceColors[op.source] ?? 'bg-white/10 text-white/50'
                )}
              >
                {op.source}
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-[0.65rem] tabular-nums text-white/50">
                {formatDurationTimer(op.startedAt, nowSeconds)}
              </span>
            </div>
          )
        })}
        {runningOverflow > 0 && (
          <Link
            href="/work-items?status=RUNNING"
            className="block px-2 py-1 text-xs text-primary hover:underline"
          >
            +{runningOverflow} more running
          </Link>
        )}
        {visibleQueued.map((op) => {
          const config = parseAgentIdentityConfig(op.agentConfig)
          return (
            <div
              key={op.dispatchId}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.03]"
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
              <AgentAvatar
                emoji={config.emoji ?? null}
                avatarUrl={config.avatarUrl ?? null}
                name={op.agentName}
              />
              <span className="min-w-0 flex-1 truncate text-xs text-white/50">{op.title}</span>
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[0.55rem]',
                  sourceColors[op.source] ?? 'bg-white/10 text-white/50'
                )}
              >
                {op.source}
              </span>
              <span className="w-14 shrink-0 text-right text-[0.65rem] text-amber-400/70">
                queued
              </span>
            </div>
          )
        })}
        {queuedOverflow > 0 && (
          <Link
            href="/work-items?status=QUEUED"
            className="block px-2 py-1 text-xs text-primary hover:underline"
          >
            +{queuedOverflow} queued
          </Link>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Cost Breakdown Panel
// ---------------------------------------------------------------------------

const barConfig: ChartConfig = {
  total: { label: 'Spend', color: 'var(--chart-1)' },
}

function CostBreakdownPanel({
  costByAgent,
  costBySource,
}: {
  costByAgent: Array<{ agentId: string; agentName: string; total: number; callCount: number }>
  costBySource: Array<{ source: string; total: number; callCount: number }>
}) {
  const [showBySource, setShowBySource] = useState(false)
  const top10 = costByAgent.slice(0, 10)

  if (top10.length === 0) {
    return (
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Cost Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[120px] items-center justify-center text-sm text-muted-foreground">
            No cost data for this period.
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          Cost Breakdown
          <Link
            href="/costs"
            className="text-xs font-normal text-muted-foreground hover:text-primary"
          >
            Full details
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ChartContainer config={barConfig} className="h-[200px] w-full">
          <BarChart data={top10} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v: number) => formatCost(v)}
              stroke="var(--muted-foreground)"
              fontSize={10}
            />
            <YAxis
              type="category"
              dataKey="agentName"
              stroke="var(--muted-foreground)"
              fontSize={10}
              width={80}
              tickLine={false}
            />
            <ChartTooltip
              content={<ChartTooltipContent formatter={(value) => formatCost(value as number)} />}
            />
            <Bar
              dataKey="total"
              fill="var(--color-total)"
              fillOpacity={0.5}
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ChartContainer>

        {/* Cost by Source toggle */}
        {costBySource.length > 0 && (
          <div>
            <button
              onClick={() => setShowBySource(!showBySource)}
              className="flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
            >
              {showBySource ? (
                <IconChevronUp className="h-3 w-3" />
              ) : (
                <IconChevronDown className="h-3 w-3" />
              )}
              Cost by Source
            </button>
            {showBySource && (
              <div className="mt-2">
                <ChartContainer config={barConfig} className="h-[150px] w-full">
                  <BarChart data={costBySource} layout="vertical">
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--border)"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) => formatCost(v)}
                      stroke="var(--muted-foreground)"
                      fontSize={10}
                    />
                    <YAxis
                      type="category"
                      dataKey="source"
                      stroke="var(--muted-foreground)"
                      fontSize={10}
                      width={70}
                      tickLine={false}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent formatter={(value) => formatCost(value as number)} />
                      }
                    />
                    <Bar
                      dataKey="total"
                      fill="var(--color-total)"
                      fillOpacity={0.5}
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Needs Attention Panel
// ---------------------------------------------------------------------------

function NeedsAttentionPanel({
  alerts,
}: {
  alerts: Array<{
    type: string
    severity: 'critical' | 'warning'
    message: string
    agentId?: string
    link: string
  }>
}) {
  if (alerts.length === 0) {
    return (
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Needs Attention</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-center text-emerald-400/70">
            <IconCircleCheck className="mb-2 h-6 w-6" />
            <p className="text-xs">Fleet is healthy</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          Needs Attention
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {alerts.length} alert{alerts.length !== 1 ? 's' : ''}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {alerts.map((alert, i) => (
          <Link
            key={`${alert.type}-${alert.agentId ?? 'global'}-${i}`}
            href={alert.link}
            className="flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.03]"
          >
            {alert.severity === 'critical' ? (
              <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
            ) : (
              <IconInfoCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            )}
            <span className="text-xs text-white/70">{alert.message}</span>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

type RecentSession = {
  sessionKey: string
  displayTitle: string
  lastMessageAt: number
  participants: Array<{
    id: string
    name: string
    emoji: string | null
    avatarUrl: string | null
  }>
}

export function FleetDashboard({
  recentSessions,
}: {
  recentSessions?: RecentSession[]
} = {}) {
  const [period, setPeriod] = useState<Period>('7d')
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'busy' | 'idle'>('all')

  const fleet = trpc.commandCenter.getFleetStatus.useQuery(
    { period },
    {
      refetchInterval: 30_000,
      staleTime: 15_000,
    }
  )

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortKey(key)
        setSortDir('desc')
      }
    },
    [sortKey]
  )

  // Build sparkline map
  const sparklineMap = useMemo(() => {
    if (!fleet.data) return new Map<string, number[]>()
    const map = new Map<string, Map<string, number>>()
    for (const s of fleet.data.sparklines) {
      if (!map.has(s.agentId)) map.set(s.agentId, new Map())
      map.get(s.agentId)!.set(s.day, s.runCount)
    }
    // Build ordered 7-day arrays
    const result = new Map<string, number[]>()
    const now = new Date()
    const days: string[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      days.push(d.toISOString().split('T')[0]!)
    }
    for (const [agentId, dayMap] of map) {
      result.set(
        agentId,
        days.map((day) => dayMap.get(day) ?? 0)
      )
    }
    return result
  }, [fleet.data])

  // Filter and sort roster
  const sortedRoster = useMemo(() => {
    if (!fleet.data) return []
    let filtered = [...fleet.data.roster]

    // Search filter
    if (search) {
      const q = search.toLowerCase()
      filtered = filtered.filter(
        (a) => a.name.toLowerCase().includes(q) || a.handle.toLowerCase().includes(q)
      )
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((a) => a.status === statusFilter)
    }

    // Sort
    filtered.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'status':
          cmp = a.status === b.status ? 0 : a.status === 'busy' ? -1 : 1
          break
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'runCount':
          cmp = a.runCount - b.runCount
          break
        case 'successRate': {
          const aRate = a.runCount > 0 ? a.completedCount / a.runCount : -1
          const bRate = b.runCount > 0 ? b.completedCount / b.runCount : -1
          cmp = aRate - bRate
          break
        }
        case 'avgScore':
          cmp = (a.avgScore ?? -1) - (b.avgScore ?? -1)
          break
        case 'cost':
          cmp = a.cost - b.cost
          break
        case 'lastActiveAt':
          cmp = (a.lastActiveAt ?? 0) - (b.lastActiveAt ?? 0)
          break
      }
      return sortDir === 'desc' ? -cmp : cmp
    })

    return filtered
  }, [fleet.data, search, statusFilter, sortKey, sortDir])

  if (fleet.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        Loading fleet status...
      </div>
    )
  }

  if (fleet.error) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-destructive">
        Failed to load fleet status.
      </div>
    )
  }

  const data = fleet.data!

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Fleet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Fleet health, activity, and cost posture at a glance.
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total Agents" value={String(data.summary.totalAgents)} icon={IconRobot} />
        <StatCard
          label="Active Now"
          value={String(data.summary.activeNow)}
          icon={IconActivity}
          tint={data.summary.activeNow > 0 ? 'green' : null}
        />
        <StatCard label="Runs" value={String(data.summary.runsInPeriod)} icon={IconPlayerPlay} />
        <StatCard
          label="Avg Duration"
          value={formatAvgDuration(data.summary.avgDurationSeconds)}
          icon={IconClock}
        />
        <StatCard
          label="Total Cost"
          value={formatCost(data.summary.totalCost)}
          icon={IconCurrencyDollar}
        />
        <StatCard
          label="Pending"
          value={String(data.summary.pendingItems)}
          icon={IconHourglass}
          tint={data.summary.pendingItems > 0 ? 'amber' : null}
        />
      </div>

      {/* Fleet Grid: left 2/3, right 1/3 */}
      <div className="grid gap-6 xl:grid-cols-3">
        {/* Left column */}
        <div className="space-y-6 xl:col-span-2">
          {/* Agent Roster Table */}
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                Agent Roster
                <div className="flex items-center gap-2">
                  {/* Status filter pills */}
                  {(['all', 'busy', 'idle'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={cn(
                        'rounded-md px-2 py-0.5 text-[0.65rem] font-medium transition-all capitalize',
                        statusFilter === s
                          ? 'bg-white/10 text-white'
                          : 'text-white/40 hover:text-white/70'
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Search */}
              <div className="mb-3">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search agents..."
                  className="w-full rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                />
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader
                      label="Agent"
                      sortKey="name"
                      currentSort={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Status"
                      sortKey="status"
                      currentSort={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      className="w-[70px]"
                    />
                    <SortableHeader
                      label="Runs"
                      sortKey="runCount"
                      currentSort={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      className="text-right"
                    />
                    <SortableHeader
                      label="Success"
                      sortKey="successRate"
                      currentSort={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      className="text-right"
                    />
                    <SortableHeader
                      label="Avg Score"
                      sortKey="avgScore"
                      currentSort={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      className="text-right"
                    />
                    <SortableHeader
                      label="Cost"
                      sortKey="cost"
                      currentSort={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      className="text-right"
                    />
                    <SortableHeader
                      label="Last Active"
                      sortKey="lastActiveAt"
                      currentSort={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      className="text-right"
                    />
                    <TableHead className="text-right">Trend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRoster.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                        {search ? 'No matching agents.' : 'No agents configured.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedRoster.map((agent) => {
                      const config = parseAgentIdentityConfig(agent.config)
                      const successRate =
                        agent.runCount > 0
                          ? Math.round((agent.completedCount / agent.runCount) * 100)
                          : null
                      const sparkData = sparklineMap.get(agent.agentId) ?? []
                      const successColor =
                        successRate === null
                          ? ''
                          : successRate >= 90
                            ? 'text-emerald-400'
                            : successRate >= 70
                              ? 'text-amber-400'
                              : 'text-red-400'

                      return (
                        <TableRow key={agent.agentId}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/agents/${agent.agentId}`}
                                className="flex min-w-0 items-center gap-2 hover:text-primary"
                              >
                                <AgentAvatar
                                  emoji={config.emoji ?? null}
                                  avatarUrl={config.avatarUrl ?? null}
                                  name={agent.name}
                                />
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-medium">{agent.name}</div>
                                  <div className="truncate text-[0.6rem] text-muted-foreground">
                                    @{agent.handle}
                                  </div>
                                </div>
                              </Link>
                              <ChatWithAgentButton
                                agentId={agent.agentId}
                                agentName={agent.name}
                                variant="icon"
                                className="ml-auto shrink-0"
                              />
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  'h-2 w-2 rounded-full',
                                  agent.status === 'busy'
                                    ? 'animate-pulse bg-emerald-400'
                                    : 'bg-white/20'
                                )}
                              />
                              <span
                                className={cn(
                                  'text-xs capitalize',
                                  agent.status === 'busy'
                                    ? 'text-emerald-400'
                                    : 'text-muted-foreground'
                                )}
                              >
                                {agent.status}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {agent.runCount}
                          </TableCell>
                          <TableCell className={cn('text-right tabular-nums', successColor)}>
                            {successRate !== null ? `${successRate}%` : '--'}
                          </TableCell>
                          <TableCell
                            className={cn('text-right tabular-nums', successColor)}
                            title="Based on run success rate. Eval scores coming soon."
                          >
                            {successRate !== null ? `${successRate}%` : '--'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums" title={`$${agent.cost}`}>
                            {formatCost(agent.cost)}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {formatRelativeTime(agent.lastActiveAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Sparkline data={sparkData} />
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Cost Breakdown */}
          <CostBreakdownPanel costByAgent={data.costByAgent} costBySource={data.costBySource} />
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <ActiveOperationsPanel operations={data.activeOperations} />
          <NeedsAttentionPanel alerts={data.needsAttention} />

          {/* Recent Sessions */}
          {recentSessions && recentSessions.length > 0 && (
            <Card className="border-white/10 bg-white/[0.02]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Recent Sessions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {recentSessions.slice(0, 3).map((session) => (
                    <Link
                      key={session.sessionKey}
                      href={`/sessions/${encodeURIComponent(session.sessionKey)}`}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-white/[0.03]"
                    >
                      <AvatarGroup>
                        {session.participants.slice(0, 2).map((p) => (
                          <Avatar key={p.id} size="sm">
                            {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt={p.name} /> : null}
                            <AvatarFallback>
                              {p.emoji || p.name.slice(0, 1).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                        {session.participants.length > 2 && (
                          <AvatarGroupCount>+{session.participants.length - 2}</AvatarGroupCount>
                        )}
                      </AvatarGroup>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{session.displayTitle}</p>
                      </div>
                      <span className="shrink-0 text-[0.6rem] text-muted-foreground">
                        {formatRelativeTime(session.lastMessageAt)}
                      </span>
                    </Link>
                  ))}
                </div>
                <Link
                  href="/sessions"
                  className="mt-2 block text-center text-xs text-muted-foreground transition hover:text-foreground"
                >
                  View all sessions
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Quick links */}
          <Card className="border-white/10 bg-white/[0.02]">
            <CardContent className="pt-4">
              <div className="space-y-1">
                <Link
                  href="/activity"
                  className="block rounded-md px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-white/[0.03] hover:text-foreground"
                >
                  View all activity
                </Link>
                <Link
                  href="/costs"
                  className="block rounded-md px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-white/[0.03] hover:text-foreground"
                >
                  Full cost dashboard
                </Link>
                <Link
                  href="/fleet"
                  className="block rounded-md px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-white/[0.03] hover:text-foreground"
                >
                  Manage agents
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
