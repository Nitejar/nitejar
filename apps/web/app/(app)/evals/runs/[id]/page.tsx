import { PageHeader } from '@/app/(app)/components/PageHeader'
import { EvalRunDetailClient } from './EvalRunDetailClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EvalRunDetailPage({ params }: Props) {
  const { id } = await params

  return (
    <div className="space-y-6">
      <PageHeader
        category="Evals"
        title="Eval Run"
        backLink={{ href: '/evals', label: 'Eval Dashboard' }}
      />
      <EvalRunDetailClient runId={id} />
    </div>
  )
}
