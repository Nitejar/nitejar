import loadable from 'next/dynamic'
import { createPageMetadata } from '@/app/metadata'
import { RouteClientFallback } from '@/app/(app)/components/RouteClientFallback'
import { PageHeader } from '../../components/PageHeader'
import { PageScrollShell } from '../../components/PageScrollShell'

const AgentBuilderWizard = loadable(
  () => import('./AgentBuilderWizard').then((mod) => mod.AgentBuilderWizard),
  {
    loading: () => (
      <RouteClientFallback label="Loading agent builder..." className="min-h-[480px]" />
    ),
  }
)

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Agent Builder')

export default function AgentBuilderPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        backLink={{ href: '/agents', label: 'Agents' }}
        title="Agent Builder"
        description="Create a fully configured agent step by step."
      />
      <AgentBuilderWizard />
    </PageScrollShell>
  )
}
