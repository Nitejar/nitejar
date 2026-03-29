import loadable from 'next/dynamic'
import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '../components/PageHeader'
import { PageScrollShell } from '../components/PageScrollShell'
import { RouteClientFallback } from '../components/RouteClientFallback'

const SessionsListClient = loadable(
  () => import('./SessionsListClient').then((mod) => mod.SessionsListClient),
  {
    loading: () => <RouteClientFallback label="Loading sessions..." />,
  }
)

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
