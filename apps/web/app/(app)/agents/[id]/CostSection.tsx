'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'
import { formatCost } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
import { IconCurrencyDollar, IconTrash } from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'

const trendConfig: ChartConfig = {
  total_cost: { label: 'Daily Cost', color: 'var(--chart-2)' },
}

const sourceConfig: ChartConfig = {
  total: { label: 'Spend', color: 'var(--chart-1)' },
}

export function CostSection({ agentId }: { agentId: string }) {
  const costs = trpc.costs.getAgentCosts.useQuery({ agentId })
  const limits = trpc.costs.getLimits.useQuery({ agentId })
  const orgLimits = trpc.costs.getOrgLimits.useQuery()
  const utils = trpc.useUtils()

  const setLimitMutation = trpc.costs.setLimit.useMutation({
    onSuccess: () => utils.costs.getLimits.invalidate({ agentId }),
  })
  const deleteLimitMutation = trpc.costs.deleteLimit.useMutation({
    onSuccess: () => utils.costs.getLimits.invalidate({ agentId }),
  })

  const [newPeriod, setNewPeriod] = useState<'hourly' | 'daily' | 'monthly'>('daily')
  const [newLimitUsd, setNewLimitUsd] = useState('')
  const [newSoftPct, setNewSoftPct] = useState('100')
  const [newHardPct, setNewHardPct] = useState('150')

  if (costs.isLoading) {
    return (
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <IconCurrencyDollar className="h-4 w-4 text-muted-foreground" />
            Inference Costs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            Loading cost data...
          </div>
        </CardContent>
      </Card>
    )
  }

  if (costs.error) {
    return (
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <IconCurrencyDollar className="h-4 w-4 text-muted-foreground" />
            Inference Costs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-sm text-destructive">
            Failed to load cost data.
          </div>
        </CardContent>
      </Card>
    )
  }

  const data = costs.data!

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <IconCurrencyDollar className="h-4 w-4 text-muted-foreground" />
          Inference Costs
        </CardTitle>
        <CardDescription className="text-xs">
          Cost breakdown by source, daily trends, and budget limits.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Charts Row */}
        <div className="grid gap-6 xl:grid-cols-2">
          {/* Cost by Source */}
          <div>
            <h4 className="mb-3 text-sm font-medium text-muted-foreground">Cost by Source</h4>
            {data.bySource.length > 0 ? (
              <ChartContainer config={sourceConfig} className="h-[200px] w-full">
                <BarChart data={data.bySource}>
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
          </div>

          {/* Daily Trend */}
          <div>
            <h4 className="mb-3 text-sm font-medium text-muted-foreground">Daily Trend (30d)</h4>
            {data.trend.length > 0 ? (
              <ChartContainer config={trendConfig} className="h-[200px] w-full">
                <LineChart data={data.trend}>
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
              <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                No trend data yet.
              </div>
            )}
          </div>
        </div>

        {/* Cost Limits */}
        <div className="border-t border-white/5 pt-4">
          <h4 className="mb-3 text-sm font-medium text-muted-foreground">Cost Limits</h4>

          {/* Inherited limits (org-level) */}
          {orgLimits.data && orgLimits.data.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs text-muted-foreground">Inherited (org-wide)</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Scope</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Limit</TableHead>
                    <TableHead>Soft / Hard</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgLimits.data.map((limit) => (
                    <TableRow key={limit.id} className="opacity-60">
                      <TableCell>
                        <Badge variant="default" className="text-[10px]">
                          Org
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm capitalize">{limit.period}</TableCell>
                      <TableCell className="tabular-nums">{formatCost(limit.limit_usd)}</TableCell>
                      <TableCell className="text-xs tabular-nums text-muted-foreground">
                        {limit.soft_limit_pct}% / {limit.hard_limit_pct}%
                      </TableCell>
                      <TableCell>
                        <span
                          className={`text-xs ${limit.enabled ? 'text-emerald-400' : 'text-muted-foreground'}`}
                        >
                          {limit.enabled ? 'Active' : 'Disabled'}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Agent-specific limits */}
          {limits.data && limits.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Limit</TableHead>
                  <TableHead>Soft / Hard</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {limits.data.map((limit) => (
                  <TableRow key={limit.id}>
                    <TableCell className="text-sm capitalize">{limit.period}</TableCell>
                    <TableCell className="tabular-nums">{formatCost(limit.limit_usd)}</TableCell>
                    <TableCell className="text-xs tabular-nums text-muted-foreground">
                      {limit.soft_limit_pct}% / {limit.hard_limit_pct}%
                    </TableCell>
                    <TableCell>
                      <span
                        className={`text-xs ${limit.enabled ? 'text-emerald-400' : 'text-muted-foreground'}`}
                      >
                        {limit.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <button
                        onClick={() => deleteLimitMutation.mutate({ id: limit.id })}
                        className="rounded p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                        disabled={deleteLimitMutation.isPending}
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">
              No agent-specific cost limits configured.
            </p>
          )}

          {/* Add Limit Form */}
          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-white/5 pt-4">
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
                placeholder="1.00"
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
                  scope: 'agent',
                  agentId,
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
              Add Limit
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
