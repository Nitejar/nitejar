import { PageHeader } from '@/app/(app)/components/PageHeader'
import { EvaluatorListClient } from './EvaluatorListClient'

export const dynamic = 'force-dynamic'

export default function EvaluatorsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        category="Evals"
        title="Evaluators"
        description="All evaluators available for scoring agent runs."
        backLink={{ href: '/evals', label: 'Eval Dashboard' }}
        action={{ href: '/evals/evaluators/new', label: 'Create Evaluator' }}
      />
      <EvaluatorListClient />
    </div>
  )
}
