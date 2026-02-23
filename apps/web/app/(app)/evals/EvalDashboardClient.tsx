'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  IconReportAnalytics,
  IconTrendingUp,
  IconTrendingDown,
  IconMinus,
  IconPlayerPlay,
  IconSettings,
  IconPlus,
  IconCheck,
  IconX,
  IconChevronRight,
  IconUsers,
} from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import { IconChevronDown } from '@tabler/icons-react'

function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'text-muted-foreground'
  if (score >= 0.8) return 'text-emerald-400'
  if (score >= 0.6) return 'text-yellow-400'
  return 'text-red-400'
}

function scoreBg(score: number | null | undefined): string {
  if (score == null) return 'bg-muted'
  if (score >= 0.8) return 'bg-emerald-500'
  if (score >= 0.6) return 'bg-yellow-500'
  return 'bg-red-500'
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'improving') return <IconTrendingUp className="h-4 w-4 text-emerald-400" />
  if (trend === 'declining') return <IconTrendingDown className="h-4 w-4 text-red-400" />
  return <IconMinus className="h-4 w-4 text-muted-foreground" />
}

function trendLabel(trend: string): string {
  if (trend === 'improving') return 'Improving'
  if (trend === 'declining') return 'Declining'
  if (trend === 'stable') return 'Stable'
  return 'Not enough data'
}

function SparklineBar({ data }: { data: Array<{ avg_score: number; eval_count: number }> }) {
  if (data.length === 0) {
    return (
      <div className="flex h-12 items-end gap-0.5">
        <p className="text-xs text-muted-foreground">No trend data yet.</p>
      </div>
    )
  }

  const maxCount = Math.max(...data.map((d) => d.eval_count), 1)

  return (
    <div className="flex h-12 items-end gap-0.5">
      {data.map((d, i) => {
        const heightPct = Math.max((d.eval_count / maxCount) * 100, 8)
        return (
          <div
            key={i}
            className={`min-w-1 flex-1 rounded-t-sm ${scoreBg(d.avg_score)}`}
            style={{ height: `${heightPct}%`, opacity: 0.5 + (d.avg_score ?? 0) * 0.5 }}
            title={`Score: ${(d.avg_score ?? 0).toFixed(2)} | Evals: ${d.eval_count}`}
          />
        )
      })}
    </div>
  )
}

export function EvalDashboardClient({ initialAgentId }: { initialAgentId?: string }) {
  const router = useRouter()
  const [selectedAgentId, setSelectedAgentId] = useState<string>(initialAgentId ?? '')
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)

  const agentsQuery = trpc.org.listAgents.useQuery()
  const agents = agentsQuery.data ?? []

  const isFleetView = !selectedAgentId
  const selectedAgent = agents.find((a) => a.id === selectedAgentId)
  const selectedAgentLabel = selectedAgent
    ? `${selectedAgent.emoji ? selectedAgent.emoji + ' ' : ''}${selectedAgent.name}`
    : 'All Agents'

  // Fleet-wide queries (used when no agent selected)
  const fleetSummaryQuery = trpc.evals.getFleetEvalSummary.useQuery(undefined, {
    enabled: isFleetView,
  })
  const perAgentStatsQuery = trpc.evals.getFleetPerAgentStats.useQuery(undefined, {
    enabled: isFleetView,
  })

  // Agent-specific queries (used when an agent is selected)
  const agentSummaryQuery = trpc.evals.getAgentEvalSummary.useQuery(
    { agentId: selectedAgentId },
    { enabled: !isFleetView }
  )

  // Shared queries that adapt based on selection
  const trendQuery = trpc.evals.getScoreTrend.useQuery(
    isFleetView ? { days: 30 } : { agentId: selectedAgentId, days: 30 },
    { enabled: true }
  )

  const evaluatorsQuery = trpc.evals.listEvaluators.useQuery()

  const runsQuery = trpc.evals.listEvalRuns.useQuery(
    isFleetView ? { limit: 10 } : { agentId: selectedAgentId, limit: 10 },
    { enabled: true }
  )

  const fleetSummary = fleetSummaryQuery.data
  const agentSummary = agentSummaryQuery.data
  const perAgentStats = perAgentStatsQuery.data ?? []
  const trend = trendQuery.data ?? []
  const runs = runsQuery.data?.runs ?? []
  const evaluators = evaluatorsQuery.data ?? []

  // Unified summary values for overview cards
  const totalEvals = isFleetView ? (fleetSummary?.totalEvals ?? 0) : (agentSummary?.totalEvals ?? 0)
  const avgScore = isFleetView ? fleetSummary?.avgOverallScore : agentSummary?.avgOverallScore
  const recentTrend = isFleetView ? undefined : agentSummary?.recentTrend
  const gatePassRate = isFleetView ? fleetSummary?.gatePassRate : agentSummary?.gatePassRate

  function handleAgentChange(value: string) {
    setSelectedAgentId(value)
    if (value) {
      router.replace(`/evals?agentId=${value}`, { scroll: false })
    } else {
      router.replace('/evals', { scroll: false })
    }
  }

  return (
    <div className="space-y-6">
      {/* Toolbar: agent selector + actions */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label className="text-xs text-muted-foreground">Agent:</label>
          <Popover open={agentPickerOpen} onOpenChange={setAgentPickerOpen}>
            <PopoverTrigger
              render={
                <Button variant="outline" size="sm" className="w-48 justify-between text-xs" />
              }
            >
              {selectedAgentLabel}
              <IconChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-52 p-0">
              <Command>
                <CommandInput placeholder="Search agents..." />
                <CommandList>
                  <CommandEmpty>No agents found</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      data-checked={isFleetView}
                      onSelect={() => {
                        handleAgentChange('')
                        setAgentPickerOpen(false)
                      }}
                    >
                      All Agents
                    </CommandItem>
                    {agents.map((agent) => (
                      <CommandItem
                        key={agent.id}
                        data-checked={selectedAgentId === agent.id}
                        onSelect={() => {
                          handleAgentChange(agent.id)
                          setAgentPickerOpen(false)
                        }}
                      >
                        {agent.emoji && <span>{agent.emoji}</span>}
                        {agent.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/evals/evaluators/new"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/10"
          >
            <IconPlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New Evaluator</span>
          </Link>
          <Link
            href="/evals/evaluators"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
          >
            <IconReportAnalytics className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Evaluators</span>
          </Link>
          <Link
            href="/evals/settings"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
          >
            <IconSettings className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Settings</span>
          </Link>
        </div>
      </div>

      {/* Overview cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="pb-2">
            <CardDescription className="text-[10px] uppercase tracking-wider">
              Total Eval Runs
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{totalEvals}</p>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="pb-2">
            <CardDescription className="text-[10px] uppercase tracking-wider">
              Avg Score
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-semibold ${scoreColor(avgScore)}`}>
              {avgScore != null ? (avgScore * 100).toFixed(0) + '%' : '--'}
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="pb-2">
            <CardDescription className="text-[10px] uppercase tracking-wider">
              {isFleetView ? 'Gate Pass Rate' : 'Recent Trend'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isFleetView ? (
              <p className={`text-2xl font-semibold ${scoreColor(gatePassRate)}`}>
                {gatePassRate != null ? (gatePassRate * 100).toFixed(0) + '%' : '--'}
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <TrendIcon trend={recentTrend ?? 'insufficient_data'} />
                <p className="text-sm font-medium">
                  {trendLabel(recentTrend ?? 'insufficient_data')}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="pb-2">
            <CardDescription className="text-[10px] uppercase tracking-wider">
              Active Evaluators
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{evaluators.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Per-agent breakdown table (fleet view only) */}
      {isFleetView && perAgentStats.length > 0 && (
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconUsers className="h-4 w-4 text-muted-foreground" />
              Per-Agent Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 pr-4">Agent</th>
                    <th className="pb-2 pr-4 text-right">Avg Score</th>
                    <th className="pb-2 pr-4 text-right">Evals</th>
                    <th className="pb-2 pr-4 text-right">Gate Pass Rate</th>
                    <th className="pb-2 text-right">Eval Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {perAgentStats.map((stat) => (
                    <tr
                      key={stat.agent_id}
                      className="cursor-pointer border-b border-white/5 transition hover:bg-white/[0.04]"
                      onClick={() => handleAgentChange(stat.agent_id)}
                    >
                      <td className="py-2 pr-4 font-medium">{stat.agent_name}</td>
                      <td className={`py-2 pr-4 text-right ${scoreColor(stat.avg_score)}`}>
                        {stat.avg_score != null ? (stat.avg_score * 100).toFixed(0) + '%' : '--'}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{stat.total_evals}</td>
                      <td className={`py-2 pr-4 text-right ${scoreColor(stat.gate_pass_rate)}`}>
                        {stat.gate_pass_rate != null
                          ? (stat.gate_pass_rate * 100).toFixed(0) + '%'
                          : '--'}
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        ${stat.eval_cost.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Score trend chart */}
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <IconReportAnalytics className="h-4 w-4 text-muted-foreground" />
            Score Trend (30 days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SparklineBar data={trend} />
          {trend.length > 0 && (
            <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
              <span>{trend[0]?.date}</span>
              <span>{trend[trend.length - 1]?.date}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent eval runs */}
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <IconPlayerPlay className="h-4 w-4 text-muted-foreground" />
              Recent Eval Runs
            </CardTitle>
            <CardDescription className="text-xs">
              {isFleetView
                ? 'Latest evaluation results across all agents.'
                : 'Latest evaluation results for the selected agent.'}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/10 py-8">
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                <IconReportAnalytics className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No eval runs yet</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Create an evaluator and assign it to an agent to start scoring runs.
              </p>
              <Link
                href="/evals/evaluators/new"
                className="mt-2 text-xs text-primary hover:underline"
              >
                Create an evaluator &rarr;
              </Link>
            </div>
          ) : (
            <div className="space-y-1">
              {runs.map((run) => (
                <Link
                  key={run.id}
                  href={`/evals/runs/${run.id}`}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] p-3 transition hover:border-white/20 hover:bg-white/[0.04]"
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {isFleetView && run.agent_name && (
                          <span className="text-[10px] font-medium text-primary">
                            {run.agent_name}
                          </span>
                        )}
                        <p className="text-xs font-medium">
                          {new Date(run.created_at * 1000).toLocaleString()}
                        </p>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <Badge
                          variant={run.status === 'completed' ? 'secondary' : 'outline'}
                          className="text-[10px]"
                        >
                          {run.status}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">{run.trigger}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {run.overall_score != null && (
                      <span className={`text-sm font-semibold ${scoreColor(run.overall_score)}`}>
                        {(run.overall_score * 100).toFixed(0)}%
                      </span>
                    )}
                    {run.gates_passed != null &&
                      (run.gates_passed === 1 ? (
                        <IconCheck className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <IconX className="h-4 w-4 text-red-400" />
                      ))}
                    <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
