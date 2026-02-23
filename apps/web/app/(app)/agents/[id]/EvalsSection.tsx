'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  IconReportAnalytics,
  IconTrendingUp,
  IconTrendingDown,
  IconMinus,
  IconPlus,
  IconTrash,
  IconCheck,
  IconX,
  IconChevronRight,
} from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'text-muted-foreground'
  if (score >= 0.8) return 'text-emerald-400'
  if (score >= 0.6) return 'text-yellow-400'
  return 'text-red-400'
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

// ============================================================================
// Assign Evaluator Dialog
// ============================================================================

function AssignEvaluatorDialog({
  agentId,
  onAssigned,
}: {
  agentId: string
  onAssigned: () => void
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const evaluatorsQuery = trpc.evals.listEvaluators.useQuery(undefined, { enabled: open })
  const evaluators = evaluatorsQuery.data ?? []

  const assignMutation = trpc.evals.assignEvaluatorToAgent.useMutation({
    onSuccess: () => {
      setOpen(false)
      setError(null)
      onAssigned()
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="rounded-md border border-primary/40 bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary transition hover:border-primary/60 hover:bg-primary/20"
          >
            <span className="flex items-center gap-1">
              <IconPlus className="h-3 w-3" />
              Assign Evaluator
            </span>
          </button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Evaluator</DialogTitle>
          <DialogDescription>
            Select an evaluator to assign to this agent. You can create evaluators from the Evals
            section.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {error && <p className="text-xs text-destructive">{error}</p>}

          {evaluatorsQuery.isLoading ? (
            <p className="py-4 text-center text-xs text-muted-foreground">Loading evaluators...</p>
          ) : evaluators.length === 0 ? (
            <div className="py-4 text-center">
              <p className="text-xs text-muted-foreground">No evaluators available.</p>
              <Link
                href="/evals/evaluators/new"
                className="mt-1 text-xs text-primary hover:underline"
              >
                Create one first &rarr;
              </Link>
            </div>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {evaluators.map((evaluator) => (
                <button
                  key={evaluator.id}
                  type="button"
                  onClick={() => {
                    setError(null)
                    assignMutation.mutate({
                      agentId,
                      evaluatorId: evaluator.id,
                    })
                  }}
                  disabled={assignMutation.isPending}
                  className="flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-2.5 text-left transition hover:border-primary/30 hover:bg-white/[0.04]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">{evaluator.name}</p>
                    {evaluator.description && (
                      <p className="truncate text-[10px] text-muted-foreground">
                        {evaluator.description}
                      </p>
                    )}
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {evaluator.type}
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <p className="text-[10px] text-muted-foreground">
            Or{' '}
            <Link href="/evals/evaluators/new" className="text-primary hover:underline">
              create a new evaluator
            </Link>
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Main Section
// ============================================================================

export function EvalsSection({ agentId }: { agentId: string }) {
  const utils = trpc.useUtils()

  const summaryQuery = trpc.evals.getAgentEvalSummary.useQuery({ agentId })
  const assignmentsQuery = trpc.evals.listAgentEvaluators.useQuery({ agentId })
  const runsQuery = trpc.evals.listEvalRuns.useQuery({ agentId, limit: 5 })
  const removeAssignmentMutation = trpc.evals.removeEvaluatorFromAgent.useMutation({
    onSuccess: () => {
      void utils.evals.listAgentEvaluators.invalidate({ agentId })
      void utils.evals.getAgentEvalSummary.invalidate({ agentId })
    },
  })

  const summary = summaryQuery.data
  const assignments = assignmentsQuery.data ?? []
  const runs = runsQuery.data?.runs ?? []
  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconReportAnalytics className="h-4 w-4 text-muted-foreground" />
            Evals
          </CardTitle>
          <CardDescription className="text-xs">
            Evaluation scores and assigned evaluators.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <AssignEvaluatorDialog
            agentId={agentId}
            onAssigned={() => {
              void utils.evals.listAgentEvaluators.invalidate({ agentId })
              void utils.evals.getAgentEvalSummary.invalidate({ agentId })
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Score summary */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Score</p>
            <p className={`mt-1 text-lg font-semibold ${scoreColor(summary?.avgOverallScore)}`}>
              {summary?.avgOverallScore != null
                ? (summary.avgOverallScore * 100).toFixed(0) + '%'
                : '--'}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Trend</p>
            <div className="mt-1 flex items-center gap-2">
              <TrendIcon trend={summary?.recentTrend ?? 'insufficient_data'} />
              <span className="text-xs font-medium">
                {trendLabel(summary?.recentTrend ?? 'insufficient_data')}
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Total Evals
            </p>
            <p className="mt-1 text-lg font-semibold">{summary?.totalEvals ?? 0}</p>
          </div>
        </div>

        {/* Assigned evaluators */}
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Assigned Evaluators
          </p>
          {assignments.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No evaluators assigned.{' '}
              <Link href="/evals/evaluators/new" className="text-primary hover:underline">
                Create one
              </Link>{' '}
              to start scoring runs.
            </p>
          ) : (
            <div className="space-y-1">
              {assignments.map((assignment) => (
                <div
                  key={assignment.id}
                  className="group flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/evals/evaluators/${assignment.evaluator_id}`}
                      className="text-xs font-medium hover:text-primary"
                    >
                      {assignment.evaluator_name}
                    </Link>
                    <Badge variant="secondary" className="text-[10px]">
                      {assignment.evaluator_type}
                    </Badge>
                    {assignment.is_gate === 1 && (
                      <Badge variant="outline" className="text-[10px]">
                        Gate
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">w={assignment.weight}</span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => removeAssignmentMutation.mutate({ id: assignment.id })}
                      disabled={removeAssignmentMutation.isPending}
                    >
                      <IconTrash className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent eval runs */}
        {runs.length > 0 && (
          <div>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Recent Runs
            </p>
            <div className="space-y-1">
              {runs.map((run) => (
                <Link
                  key={run.id}
                  href={`/evals/runs/${run.id}`}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] p-2.5 transition hover:border-white/20 hover:bg-white/[0.04]"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs">
                      {new Date(run.created_at * 1000).toLocaleDateString()}
                    </span>
                    <Badge
                      variant={run.status === 'completed' ? 'secondary' : 'outline'}
                      className="text-[10px]"
                    >
                      {run.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {run.overall_score != null && (
                      <span className={`text-xs font-semibold ${scoreColor(run.overall_score)}`}>
                        {(run.overall_score * 100).toFixed(0)}%
                      </span>
                    )}
                    {run.gates_passed != null &&
                      (run.gates_passed === 1 ? (
                        <IconCheck className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <IconX className="h-3.5 w-3.5 text-red-400" />
                      ))}
                    <IconChevronRight className="h-3 w-3 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
            <Link
              href={`/evals?agentId=${agentId}`}
              className="mt-2 block text-center text-xs text-muted-foreground hover:text-foreground"
            >
              View all runs &rarr;
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
