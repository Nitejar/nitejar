import { PageHeader } from '../../components/PageHeader'
import { AgentBuilderWizard } from './AgentBuilderWizard'

export const dynamic = 'force-dynamic'

export default function AgentBuilderPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        backLink={{ href: '/agents', label: 'Agents' }}
        title="Agent Builder"
        description="Create a fully configured agent step by step."
      />
      <AgentBuilderWizard />
    </div>
  )
}
