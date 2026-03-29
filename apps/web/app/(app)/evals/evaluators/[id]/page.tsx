import type { Metadata } from 'next'
import loadable from 'next/dynamic'
import { findEvaluatorById } from '@nitejar/database'
import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { PageScrollShell } from '@/app/(app)/components/PageScrollShell'
import { RouteClientFallback } from '@/app/(app)/components/RouteClientFallback'

const EvaluatorDetailClient = loadable(
  () => import('./EvaluatorDetailClient').then((mod) => mod.EvaluatorDetailClient),
  {
    loading: () => <RouteClientFallback label="Loading evaluator..." className="min-h-[420px]" />,
  }
)

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const evaluator = await findEvaluatorById(id)
  return createPageMetadata(evaluator?.name ?? 'Evaluator')
}

export default async function EvaluatorDetailPage({ params }: Props) {
  const { id } = await params

  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        category="Evals"
        title="Evaluator Detail"
        backLink={{ href: '/evals/evaluators', label: 'Evaluators' }}
      />
      <EvaluatorDetailClient evaluatorId={id} />
    </PageScrollShell>
  )
}
