import { PageHeader } from '../../components/PageHeader'
import { PluginInstallWizard } from './PluginInstallWizard'

export const dynamic = 'force-dynamic'

export default function PluginInstallPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        category="Plugins"
        title="Add a Plugin"
        description="Add a plugin by uploading a package, or paste a link."
        backLink={{ href: '/plugins', label: 'Back to Plugins' }}
      />
      <PluginInstallWizard />
    </div>
  )
}
