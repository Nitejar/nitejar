import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '../components/PageHeader'
import { PageScrollShell } from '../components/PageScrollShell'
import { SessionsListClient } from './SessionsListClient'

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Sessions')

export default function SessionsPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        category="Sessions"
        title="Sessions"
        description="Start and continue in-app conversations with one or more agents."
      />
      <SessionsListClient />
    </PageScrollShell>
  )
}
