import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { PageScrollShell } from '@/app/(app)/components/PageScrollShell'
import { EvalSettingsClient } from './EvalSettingsClient'

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Eval Settings')

export default function EvalSettingsPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        category="Evals"
        title="Eval Settings"
        description="Configure the global evaluation pipeline defaults."
        backLink={{ href: '/evals', label: 'Eval Dashboard' }}
      />
      <EvalSettingsClient />
    </PageScrollShell>
  )
}
