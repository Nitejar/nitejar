'use client'

import { useState } from 'react'
import Link from 'next/link'
import { IconReportAnalytics, IconRobot } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

const TYPE_LABELS: Record<string, string> = {
  llm_judge: 'LLM Judge',
  programmatic: 'Programmatic',
  statistical: 'Statistical',
  safety: 'Safety',
  human_feedback: 'Human Feedback',
  task_completion: 'Task Completion',
  custom: 'Custom',
}

function typeBadgeVariant(type: string): 'default' | 'secondary' | 'outline' {
  if (type === 'llm_judge') return 'default'
  if (type === 'programmatic') return 'secondary'
  return 'outline'
}

export function EvaluatorListClient() {
  const [typeFilter, setTypeFilter] = useState<string>('')

  const evaluatorsQuery = trpc.evals.listEvaluators.useQuery(
    typeFilter ? { type: typeFilter as 'llm_judge' } : undefined
  )

  const evaluators = evaluatorsQuery.data ?? []

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-muted-foreground">Filter by type:</label>
        <NativeSelect value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <NativeSelectOption value="">All Types</NativeSelectOption>
          <NativeSelectOption value="llm_judge">LLM Judge</NativeSelectOption>
          <NativeSelectOption value="programmatic">Programmatic</NativeSelectOption>
          <NativeSelectOption value="statistical">Statistical</NativeSelectOption>
          <NativeSelectOption value="safety">Safety</NativeSelectOption>
          <NativeSelectOption value="human_feedback">Human Feedback</NativeSelectOption>
          <NativeSelectOption value="task_completion">Task Completion</NativeSelectOption>
          <NativeSelectOption value="custom">Custom</NativeSelectOption>
        </NativeSelect>
      </div>

      {/* Evaluator list */}
      {evaluatorsQuery.isLoading ? (
        <p className="py-8 text-center text-xs text-muted-foreground">Loading evaluators...</p>
      ) : evaluators.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/10 py-12">
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">
            <IconReportAnalytics className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No evaluators yet</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Create one to start scoring agent runs.
          </p>
          <Link href="/evals/evaluators/new" className="mt-2 text-xs text-primary hover:underline">
            Create an evaluator &rarr;
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {evaluators.map((evaluator) => (
            <Link
              key={evaluator.id}
              href={`/evals/evaluators/${evaluator.id}`}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/20 hover:bg-white/[0.04]"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5">
                  <IconRobot className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{evaluator.name}</p>
                    <Badge variant={typeBadgeVariant(evaluator.type)} className="text-[10px]">
                      {TYPE_LABELS[evaluator.type] ?? evaluator.type}
                    </Badge>
                  </div>
                  {evaluator.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                      {evaluator.description}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{new Date(evaluator.created_at * 1000).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
