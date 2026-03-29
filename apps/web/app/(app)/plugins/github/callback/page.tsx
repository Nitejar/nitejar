import loadable from 'next/dynamic'
import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '../../../components/PageHeader'
import { PageScrollShell } from '../../../components/PageScrollShell'
import { RouteClientFallback } from '../../../components/RouteClientFallback'

const GitHubManifestCallbackClient = loadable(
  () => import('./GitHubManifestCallbackClient').then((mod) => mod.GitHubManifestCallbackClient),
  {
    loading: () => (
      <RouteClientFallback label="Loading GitHub callback..." className="min-h-[240px]" />
    ),
  }
)

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('GitHub Setup')

export default function GitHubCallbackPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        category="Plugins"
        title="GitHub App Callback"
        description="Finalize GitHub App registration."
        backLink={{ href: '/plugins', label: 'Back to Plugins' }}
      />
      <GitHubManifestCallbackClient />
    </PageScrollShell>
  )
}
