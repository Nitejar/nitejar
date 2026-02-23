import { Suspense } from 'react'
import { PageHeader } from '../../../components/PageHeader'
import { GitHubManifestCallbackClient } from './GitHubManifestCallbackClient'

export const dynamic = 'force-dynamic'

export default function GitHubCallbackPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        category="Plugins"
        title="GitHub App Callback"
        description="Finalize GitHub App registration."
        backLink={{ href: '/plugins', label: 'Back to Plugins' }}
      />

      <Suspense
        fallback={
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-6 text-sm text-muted-foreground">
            Loading...
          </div>
        }
      >
        <GitHubManifestCallbackClient />
      </Suspense>
    </div>
  )
}
