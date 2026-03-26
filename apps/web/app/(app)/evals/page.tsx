import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { PageScrollShell } from '@/app/(app)/components/PageScrollShell'
import { EvalDashboardClient } from './EvalDashboardClient'

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Evals')

export default async function EvalsPage({
  searchParams,
}: {
  searchParams: Promise<{ agentId?: string }>
}) {
  const params = await searchParams
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        category="Evals"
        title="Eval Dashboard"
        description="Monitor agent evaluation runs, scores, and trends across your fleet."
      />
      <EvalDashboardClient initialAgentId={params?.agentId} />
    </PageScrollShell>
  )
}
