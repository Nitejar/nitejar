'use client'

import { useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { formatCost } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Badge } from '@/components/ui/badge'

const trendConfig: ChartConfig = {
  total_cost: { label: 'Daily Cost', color: 'var(--chart-2)' },
}

const barConfig: ChartConfig = {
  total: { label: 'Spend', color: 'var(--chart-1)' },
}

const scopeLabel: Record<string, string> = {
  org: 'Org',
  team: 'Team',
  agent: 'Agent',
}

const scopeVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
  org: 'default',
  team: 'secondary',
  agent: 'outline',
}

export function CostsDashboard() {
  const summary = trpc.costs.getSummary.useQuery()
  const trend = trpc.costs.getTrend.useQuery({ days: 30 })
  const globalBySource = trpc.costs.getGlobalBySource.useQuery()
  const allLimits = trpc.costs.getAllLimits.useQuery()
  const utils = trpc.useUtils()

  const setLimitMutation = trpc.costs.setLimit.useMutation({
    onSuccess: () => utils.costs.getAllLimits.invalidate(),
  })
  const deleteLimitMutation = trpc.costs.deleteLimit.useMutation({
    onSuccess: () => utils.costs.getAllLimits.invalidate(),
  })

  const [newPeriod, setNewPeriod] = useState<'hourly' | 'daily' | 'monthly'>('daily')
  const [newLimitUsd, setNewLimitUsd] = useState('')
  const [newSoftPct, setNewSoftPct] = useState('100')
  const [newHardPct, setNewHardPct] = useState('150')

  if (summary.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        Loading cost data...
      </div>
    )
  }

  if (summary.error) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-destructive">
        Failed to load cost data.
      </div>
    )
  }

  const data = summary.data!

  const statCards = [
    { label: 'Total Spend', value: data.totalSpend },
    { label: 'Today', value: data.spendToday },
    { label: 'This Week', value: data.spendThisWeek },
    { label: 'This Month', value: data.spendThisMonth },
  ]

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.label} className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {stat.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums" title={`$${stat.value}`}>
                {formatCost(stat.value)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Daily Trend Chart */}
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Daily Trend (30d)</CardTitle>
        </CardHeader>
        <CardContent>
          {trend.data && trend.data.length > 0 ? (
            <ChartContainer config={trendConfig} className="h-[250px] w-full">
              <LineChart data={trend.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v: string) => v.slice(5)}
                  stroke="var(--muted-foreground)"
                  fontSize={10}
                />
                <YAxis
                  tickFormatter={(v: number) => formatCost(v)}
                  stroke="var(--muted-foreground)"
                  fontSize={10}
                  width={50}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent formatter={(value) => formatCost(value as number)} />
                  }
                />
                <Line
                  type="monotone"
                  dataKey="total_cost"
                  stroke="var(--color-total_cost)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ChartContainer>
          ) : (
            <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
              No trend data yet.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Spend by Agent + Spend by Source side by side */}
      <div className="grid gap-6 xl:grid-cols-2">
        {/* Spend by Agent */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Spend by Agent</CardTitle>
          </CardHeader>
          <CardContent>
            {data.byAgent.length > 0 ? (
              <>
                <ChartContainer config={barConfig} className="mb-4 h-[200px] w-full">
                  <BarChart data={data.byAgent}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="agent_name" stroke="var(--muted-foreground)" fontSize={10} />
                    <YAxis
                      tickFormatter={(v: number) => formatCost(v)}
                      stroke="var(--muted-foreground)"
                      fontSize={10}
                      width={50}
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
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byAgent.map((a) => (
                      <TableRow key={a.agent_id}>
                        <TableCell className="text-sm font-medium">
                          <Link href={`/agents/${a.agent_id}`} className="hover:text-primary">
                            {a.agent_name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {a.call_count}
                        </TableCell>
                        <TableCell className="text-right tabular-nums" title={`$${a.total}`}>
                          {formatCost(a.total)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            ) : (
              <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                No agent data yet.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Spend by Source */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Spend by Source</CardTitle>
          </CardHeader>
          <CardContent>
            {globalBySource.data && globalBySource.data.length > 0 ? (
              <ChartContainer config={barConfig} className="h-[200px] w-full">
                <BarChart data={globalBySource.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="source" stroke="var(--muted-foreground)" fontSize={10} />
                  <YAxis
                    tickFormatter={(v: number) => formatCost(v)}
                    stroke="var(--muted-foreground)"
                    fontSize={10}
                    width={50}
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
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                No source data yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Expensive Jobs */}
      {data.topJobs.length > 0 && (
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top Expensive Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  <TableHead className="text-right">Cache Read</TableHead>
                  <TableHead className="text-right">Cache Write</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topJobs.map((job) => (
                  <TableRow key={job.job_id}>
                    <TableCell className="max-w-[160px] truncate text-sm font-medium">
                      <Link href={`/work-items/${job.work_item_id}`} className="hover:text-primary">
                        {job.title || job.job_id.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{job.source}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {job.prompt_tokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {job.completion_tokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {job.cache_read_tokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {job.cache_write_tokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums" title={`$${job.total_cost}`}>
                      {formatCost(job.total_cost)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Budget Limits */}
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Budget Limits</CardTitle>
        </CardHeader>
        <CardContent>
          {allLimits.data && allLimits.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scope</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Limit</TableHead>
                  <TableHead className="text-right">Soft / Hard</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allLimits.data.map((limit) => (
                  <TableRow key={limit.id}>
                    <TableCell>
                      <Badge
                        variant={scopeVariant[limit.scope] ?? 'outline'}
                        className="text-[10px]"
                      >
                        {scopeLabel[limit.scope] ?? limit.scope}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {limit.scope === 'agent' && limit.agent_id ? (
                        <Link href={`/agents/${limit.agent_id}`} className="hover:text-primary">
                          {limit.agent_name ?? 'Unknown'}
                        </Link>
                      ) : limit.scope === 'team' ? (
                        <span>{limit.team_name ?? 'Unknown team'}</span>
                      ) : (
                        <span className="text-muted-foreground">All agents</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm capitalize">{limit.period}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCost(limit.limit_usd)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      {limit.soft_limit_pct}% / {limit.hard_limit_pct}%
                    </TableCell>
                    <TableCell>
                      <Badge variant={limit.enabled ? 'secondary' : 'outline'}>
                        {limit.enabled ? 'Active' : 'Disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <button
                        onClick={() => deleteLimitMutation.mutate({ id: limit.id })}
                        className="rounded p-1 text-xs text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                        disabled={deleteLimitMutation.isPending}
                      >
                        Delete
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">
              No budget limits configured. Set limits on individual agent pages or add an org-wide
              limit below.
            </p>
          )}

          {/* Add Org Limit Form */}
          <div className="mt-4 border-t border-white/5 pt-4">
            <h4 className="mb-3 text-xs font-medium text-muted-foreground">
              Add Org-Wide Budget Limit
            </h4>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Period</label>
                <select
                  value={newPeriod}
                  onChange={(e) => setNewPeriod(e.target.value as 'hourly' | 'daily' | 'monthly')}
                  className="block rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Limit (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={newLimitUsd}
                  onChange={(e) => setNewLimitUsd(e.target.value)}
                  placeholder="10.00"
                  className="block w-28 rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Soft %</label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={newSoftPct}
                  onChange={(e) => setNewSoftPct(e.target.value)}
                  className="block w-16 rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Hard %</label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={newHardPct}
                  onChange={(e) => setNewHardPct(e.target.value)}
                  className="block w-16 rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                />
              </div>
              <button
                onClick={() => {
                  const usd = parseFloat(newLimitUsd)
                  if (!usd || usd <= 0) return
                  setLimitMutation.mutate({
                    scope: 'org',
                    period: newPeriod,
                    limitUsd: usd,
                    softLimitPct: parseInt(newSoftPct) || 100,
                    hardLimitPct: parseInt(newHardPct) || 150,
                  })
                  setNewLimitUsd('')
                  setNewSoftPct('100')
                  setNewHardPct('150')
                }}
                disabled={setLimitMutation.isPending}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              >
                Add Org Limit
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
