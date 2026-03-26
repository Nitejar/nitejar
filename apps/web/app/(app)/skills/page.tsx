import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '../components/PageHeader'
import { PageScrollShell } from '../components/PageScrollShell'
import { SkillsCatalogClient } from './SkillsCatalogClient'

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Skills')

export default function SkillsPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        title="Skills"
        description="Teach your agents how to do things. Skills are knowledge, workflows, scripts, and templates synced to agent sandboxes."
      />
      <SkillsCatalogClient />
    </PageScrollShell>
  )
}
