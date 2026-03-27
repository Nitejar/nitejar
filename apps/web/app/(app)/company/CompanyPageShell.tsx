import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { buildPolicyPermissionRows, GITHUB_REPO_CAPABILITY_DESCRIPTORS } from '@nitejar/database'
import { ClientErrorBoundary } from '../components/ClientErrorBoundary'
import { CompanyClient } from './CompanyClient'

function CompanyFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

export function CompanyPageShell() {
  const permissionRows = buildPolicyPermissionRows()

  return (
    <ClientErrorBoundary label="Company">
      <Suspense fallback={<CompanyFallback />}>
        <CompanyClient
          permissionRows={permissionRows}
          githubRepoCapabilities={GITHUB_REPO_CAPABILITY_DESCRIPTORS}
        />
      </Suspense>
    </ClientErrorBoundary>
  )
}
