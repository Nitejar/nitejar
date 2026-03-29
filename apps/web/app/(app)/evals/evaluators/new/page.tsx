import loadable from 'next/dynamic'
import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { PageScrollShell } from '@/app/(app)/components/PageScrollShell'
import { RouteClientFallback } from '@/app/(app)/components/RouteClientFallback'

const EvaluatorBuilderClient = loadable(
  () => import('./EvaluatorBuilderClient').then((mod) => mod.EvaluatorBuilderClient),
  {
    loading: () => (
      <RouteClientFallback label="Loading evaluator builder..." className="min-h-[420px]" />
    ),
  }
)

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('New Evaluator')

export default function NewEvaluatorPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        category="Evals"
        title="Create Evaluator"
        description="Build a new evaluator with a rubric to score agent runs."
        backLink={{ href: '/evals/evaluators', label: 'Evaluators' }}
      />
      <EvaluatorBuilderClient />
    </PageScrollShell>
  )
}
