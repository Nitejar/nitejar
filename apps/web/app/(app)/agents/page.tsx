import { AgentsClient } from './AgentsClient'
import { AgentListActions } from './AgentListActions'
import { ClientErrorBoundary } from '../components/ClientErrorBoundary'

export const dynamic = 'force-dynamic'

export default function AgentsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[0.65rem] uppercase tracking-[0.35em] text-muted-foreground">Agents</p>
          <h2 className="text-2xl font-semibold">Agents</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Your autonomous workforce. Configure identities, manage capabilities, and monitor agent
            readiness.
          </p>
        </div>
        <AgentListActions />
      </div>

      <ClientErrorBoundary label="Agents">
        <AgentsClient />
      </ClientErrorBoundary>
    </div>
  )
}
