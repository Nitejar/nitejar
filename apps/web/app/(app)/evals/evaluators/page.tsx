import loadable from 'next/dynamic'
import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { PageScrollShell } from '@/app/(app)/components/PageScrollShell'
import { RouteClientFallback } from '@/app/(app)/components/RouteClientFallback'

const EvaluatorListClient = loadable(
  () => import('./EvaluatorListClient').then((mod) => mod.EvaluatorListClient),
  {
    loading: () => <RouteClientFallback label="Loading evaluators..." />,
  }
)

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Evaluators')

export default function EvaluatorsPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        category="Evals"
        title="Evaluators"
        description="All evaluators available for scoring agent runs."
        backLink={{ href: '/evals', label: 'Eval Dashboard' }}
        action={{ href: '/evals/evaluators/new', label: 'Create Evaluator' }}
      />
      <EvaluatorListClient />
    </PageScrollShell>
  )
}
