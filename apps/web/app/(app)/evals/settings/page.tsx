import { PageHeader } from '@/app/(app)/components/PageHeader'
import { EvalSettingsClient } from './EvalSettingsClient'

export const dynamic = 'force-dynamic'

export default function EvalSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        category="Evals"
        title="Eval Settings"
        description="Configure the global evaluation pipeline defaults."
        backLink={{ href: '/evals', label: 'Eval Dashboard' }}
      />
      <EvalSettingsClient />
    </div>
  )
}
