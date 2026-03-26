import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '../../components/PageHeader'
import { PageScrollShell } from '../../components/PageScrollShell'
import { PluginInstallWizard } from './PluginInstallWizard'

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Install Plugin')

export default function PluginInstallPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        category="Plugins"
        title="Add a Plugin"
        description="Add a plugin by uploading a package, or paste a link."
        backLink={{ href: '/plugins', label: 'Back to Plugins' }}
      />
      <PluginInstallWizard />
    </PageScrollShell>
  )
}
