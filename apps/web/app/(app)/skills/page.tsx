import { PageHeader } from '../components/PageHeader'
import { SkillsCatalogClient } from './SkillsCatalogClient'

export const dynamic = 'force-dynamic'

export default function SkillsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Skills"
        description="Teach your agents how to do things. Skills are knowledge, workflows, scripts, and templates synced to agent sandboxes."
      />
      <SkillsCatalogClient />
    </div>
  )
}
