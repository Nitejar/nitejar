import loadable from 'next/dynamic'
import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '../components/PageHeader'
import { PageScrollShell } from '../components/PageScrollShell'
import { RouteClientFallback } from '../components/RouteClientFallback'

const CostsDashboard = loadable(
  () => import('./CostsDashboard').then((mod) => mod.CostsDashboard),
  {
    loading: () => <RouteClientFallback label="Loading costs..." className="min-h-[420px]" />,
  }
)

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Costs')

export default function CostsPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        category="Finance"
        title="Costs"
        description="Inference spend across all agents — trends, breakdowns, and budget limits."
      />
      <CostsDashboard />
    </PageScrollShell>
  )
}
