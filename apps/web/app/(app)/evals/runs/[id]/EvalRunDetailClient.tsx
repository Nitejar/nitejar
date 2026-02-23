'use client'

import Link from 'next/link'
import { IconCheck, IconX, IconExternalLink } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'text-muted-foreground'
  if (score >= 0.8) return 'text-emerald-400'
  if (score >= 0.6) return 'text-yellow-400'
  return 'text-red-400'
}

function scoreBg(score: number | null | undefined): string {
  if (score == null) return 'bg-muted'
  if (score >= 0.8) return 'bg-emerald-500/20'
  if (score >= 0.6) return 'bg-yellow-500/20'
  return 'bg-red-500/20'
}

interface CriterionScore {
  criterion_id: string
  criterion_name: string
  score: number
  reasoning: string
}

interface ResultDetails {
  criteria_scores?: CriterionScore[]
  reasoning?: string
}

export function EvalRunDetailClient({ runId }: { runId: string }) {
  const runQuery = trpc.evals.getEvalRun.useQuery({ id: runId })
  const run = runQuery.data

  if (runQuery.isLoading) {
    return <p className="py-8 text-center text-xs text-muted-foreground">Loading eval run...</p>
  }

  if (!run) {
    return <p className="py-8 text-center text-xs text-muted-foreground">Eval run not found.</p>
  }

  const results = run.results ?? []

  return (
    <div className="space-y-6">
      {/* Overview */}
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Eval Run Overview</CardTitle>
              <CardDescription className="text-xs">
                {new Date(run.created_at * 1000).toLocaleString()}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Overall Score */}
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Overall Score
              </p>
              <p className={`mt-1 text-2xl font-semibold ${scoreColor(run.overall_score)}`}>
                {run.overall_score != null ? (run.overall_score * 100).toFixed(0) + '%' : '--'}
              </p>
            </div>

            {/* Gate Result */}
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Gates</p>
              <div className="mt-1 flex items-center gap-2">
                {run.gates_passed != null ? (
                  run.gates_passed === 1 ? (
                    <>
                      <IconCheck className="h-5 w-5 text-emerald-400" />
                      <span className="text-sm font-medium text-emerald-400">Passed</span>
                    </>
                  ) : (
                    <>
                      <IconX className="h-5 w-5 text-red-400" />
                      <span className="text-sm font-medium text-red-400">Failed</span>
                    </>
                  )
                ) : (
                  <span className="text-sm text-muted-foreground">N/A</span>
                )}
              </div>
            </div>

            {/* Status */}
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</p>
              <div className="mt-1">
                <Badge
                  variant={
                    run.status === 'completed'
                      ? 'secondary'
                      : run.status === 'failed'
                        ? 'destructive'
                        : 'outline'
                  }
                >
                  {run.status}
                </Badge>
              </div>
            </div>

            {/* Cost */}
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Cost</p>
              <p className="mt-1 text-sm font-medium">
                {run.total_cost_usd != null ? `$${run.total_cost_usd.toFixed(4)}` : '--'}
              </p>
            </div>
          </div>

          {/* Metadata */}
          <div className="mt-4 grid gap-3 text-xs">
            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-muted-foreground">Run ID</span>
              <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">
                {run.id}
              </code>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-muted-foreground">Trigger</span>
              <Badge variant="outline" className="text-[10px]">
                {run.trigger}
              </Badge>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-muted-foreground">Job</span>
              <Link
                href={`/work-items`}
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <code className="font-mono text-[10px]">{run.job_id.slice(0, 8)}...</code>
                <IconExternalLink className="h-3 w-3" />
              </Link>
            </div>
            {run.started_at && (
              <div className="flex justify-between border-b border-white/5 pb-2">
                <span className="text-muted-foreground">Started</span>
                <span>{new Date(run.started_at * 1000).toLocaleString()}</span>
              </div>
            )}
            {run.completed_at && (
              <div className="flex justify-between border-b border-white/5 pb-2">
                <span className="text-muted-foreground">Completed</span>
                <span>{new Date(run.completed_at * 1000).toLocaleString()}</span>
              </div>
            )}
            {run.error_text && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                <p className="text-[10px] font-medium text-destructive">Error</p>
                <p className="mt-1 text-xs text-destructive/80">{run.error_text}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Per-evaluator results */}
      {results.length > 0 && (
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Evaluator Results</CardTitle>
            <CardDescription className="text-xs">
              Per-evaluator breakdown of scores and reasoning.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {results.map((result) => {
              let details: ResultDetails | null = null
              if (result.details_json) {
                try {
                  details = JSON.parse(result.details_json) as ResultDetails
                } catch {
                  // ignore
                }
              }

              return (
                <div
                  key={result.id}
                  className="rounded-lg border border-white/10 bg-white/[0.01] p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">
                        Evaluator: {result.evaluator_id.slice(0, 8)}...
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {result.result_type}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      {result.score != null && (
                        <span className={`text-sm font-semibold ${scoreColor(result.score)}`}>
                          {(result.score * 100).toFixed(0)}%
                        </span>
                      )}
                      {result.passed != null &&
                        (result.passed === 1 ? (
                          <IconCheck className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <IconX className="h-4 w-4 text-red-400" />
                        ))}
                    </div>
                  </div>

                  {result.duration_ms != null && (
                    <p className="text-[10px] text-muted-foreground">
                      Duration: {result.duration_ms}ms
                      {result.cost_usd != null && ` | Cost: $${result.cost_usd.toFixed(4)}`}
                    </p>
                  )}

                  {/* Per-criterion scores */}
                  {details?.criteria_scores && details.criteria_scores.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-medium text-muted-foreground">
                        Criterion Breakdown:
                      </p>
                      {details.criteria_scores.map((cs) => (
                        <div
                          key={cs.criterion_id}
                          className={`rounded-md p-3 ${scoreBg(cs.score / 5)}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">{cs.criterion_name}</span>
                            <span className={`text-xs font-semibold ${scoreColor(cs.score / 5)}`}>
                              {cs.score}/5
                            </span>
                          </div>
                          {cs.reasoning && (
                            <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
                              {cs.reasoning}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* General reasoning */}
                  {details?.reasoning && !details.criteria_scores && (
                    <div className="rounded-md bg-white/[0.02] p-3">
                      <p className="text-[10px] font-medium text-muted-foreground">Reasoning:</p>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        {details.reasoning}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
