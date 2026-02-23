import { PageHeader } from '../components/PageHeader'
import { SessionsListClient } from './SessionsListClient'

export const dynamic = 'force-dynamic'

export default function SessionsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        category="Sessions"
        title="Sessions"
        description="Start and continue in-app conversations with one or more agents."
      />
      <SessionsListClient />
    </div>
  )
}
