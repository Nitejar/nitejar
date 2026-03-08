import { PageHeader } from '../components/PageHeader'
import { WorkClient } from './WorkClient'

export const dynamic = 'force-dynamic'

export default function WorkPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        category="Work"
        title="Work"
        description="Goals and tickets keep the fleet pointed at outcomes instead of loose chat threads."
      />
      <WorkClient />
    </div>
  )
}
