import { Suspense } from 'react'
import { createPageMetadata } from '@/app/metadata'
import { AgentsClient } from './AgentsClient'
import { AgentListActions } from './AgentListActions'
import { ClientErrorBoundary } from '../components/ClientErrorBoundary'
import { PageScrollShell } from '../components/PageScrollShell'
import { SkeletonSummaryCards, SkeletonTable } from '../work/skeletons'

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Agents')

function AgentsSkeleton() {
  return (
    <div className="space-y-6">
      <SkeletonSummaryCards count={4} />
      <SkeletonTable rows={5} columns={5} />
    </div>
  )
}

export default function AgentsPage() {
  return (
    <PageScrollShell className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-medium text-zinc-100">Agents</h1>
        <AgentListActions />
      </div>

      <ClientErrorBoundary label="Agents">
        <Suspense fallback={<AgentsSkeleton />}>
          <AgentsClient />
        </Suspense>
      </ClientErrorBoundary>
    </PageScrollShell>
  )
}
