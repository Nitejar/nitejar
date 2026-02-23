import { PageHeader } from '@/app/(app)/components/PageHeader'
import { EvaluatorDetailClient } from './EvaluatorDetailClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EvaluatorDetailPage({ params }: Props) {
  const { id } = await params

  return (
    <div className="space-y-6">
      <PageHeader
        category="Evals"
        title="Evaluator Detail"
        backLink={{ href: '/evals/evaluators', label: 'Evaluators' }}
      />
      <EvaluatorDetailClient evaluatorId={id} />
    </div>
  )
}
