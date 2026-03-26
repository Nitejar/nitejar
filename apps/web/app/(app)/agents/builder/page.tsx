import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '../../components/PageHeader'
import { PageScrollShell } from '../../components/PageScrollShell'
import { AgentBuilderWizard } from './AgentBuilderWizard'

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
