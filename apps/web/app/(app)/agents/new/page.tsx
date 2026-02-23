import Link from 'next/link'
import { NewAgentClient } from './NewAgentClient'

export const dynamic = 'force-dynamic'

export default function NewAgentPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[0.65rem] uppercase tracking-[0.35em] text-muted-foreground">Agents</p>
          <h2 className="text-2xl font-semibold">Create Agent</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Add a new agent identity to your org.
          </p>
        </div>
        <Link href="/agents" className="text-xs text-muted-foreground hover:text-foreground">
          Back to Agents
        </Link>
      </div>

      <NewAgentClient />
    </div>
  )
}
