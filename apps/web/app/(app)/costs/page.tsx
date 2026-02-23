import { PageHeader } from '../components/PageHeader'
import { CostsDashboard } from './CostsDashboard'

export const dynamic = 'force-dynamic'

export default function CostsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        category="Finance"
        title="Costs"
        description="Inference spend across all agents — trends, breakdowns, and budget limits."
      />
      <CostsDashboard />
    </div>
  )
}
