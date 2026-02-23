import { PageHeader } from '@/app/(app)/components/PageHeader'
import { EvaluatorBuilderClient } from './EvaluatorBuilderClient'

export const dynamic = 'force-dynamic'

export default function NewEvaluatorPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        category="Evals"
        title="Create Evaluator"
        description="Build a new evaluator with a rubric to score agent runs."
        backLink={{ href: '/evals/evaluators', label: 'Evaluators' }}
      />
      <EvaluatorBuilderClient />
    </div>
  )
}
