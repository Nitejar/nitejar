import { PageHeader } from '@/app/(app)/components/PageHeader'
import { EvalDashboardClient } from './EvalDashboardClient'

export const dynamic = 'force-dynamic'

export default async function EvalsPage({
  searchParams,
}: {
  searchParams: Promise<{ agentId?: string }>
}) {
  const params = await searchParams
  return (
    <div className="space-y-6">
      <PageHeader
        category="Evals"
        title="Eval Dashboard"
        description="Monitor agent evaluation runs, scores, and trends across your fleet."
      />
      <EvalDashboardClient initialAgentId={params?.agentId} />
    </div>
  )
}
