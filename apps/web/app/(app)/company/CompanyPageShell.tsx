import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { ClientErrorBoundary } from '../components/ClientErrorBoundary'
import { CompanyClient } from './CompanyClient'
import type { CompanyViewId } from './view-types'

type PermissionRow = {
  resource: string
  hint: string
  ops: Array<{
    op: string
    grants: Array<{ action: string; resourceType: string | null }>
  }>
}

type GitHubRepoCapabilityDescriptor = {
  id: string
  label: string
  hint: string
}

function CompanyFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

export async function CompanyPageShell({ activeViewId }: { activeViewId: CompanyViewId }) {
  let permissionRows: PermissionRow[] = []
  let githubRepoCapabilities: readonly GitHubRepoCapabilityDescriptor[] = []

  if (activeViewId === 'roles') {
    const [
      { buildPolicyPermissionRows },
      { pluginHandlerRegistry },
      { ensureBuiltinPluginHandlersLoaded },
    ] = await Promise.all([
      import('@nitejar/database'),
      import('@nitejar/plugin-handlers/registry'),
      import('@/server/services/plugins/ensure-builtin-handlers'),
    ])

    permissionRows = buildPolicyPermissionRows()
    await ensureBuiltinPluginHandlersLoaded()
    const githubManagementConfig = pluginHandlerRegistry.get('github')?.managementConfig
    githubRepoCapabilities =
      githubManagementConfig?.repoAccess?.kind === 'github_repo_capabilities'
        ? githubManagementConfig.repoAccess.capabilityDescriptors
        : []
  }

  return (
    <ClientErrorBoundary label="Company">
      <Suspense fallback={<CompanyFallback />}>
        <CompanyClient
          activeViewId={activeViewId}
          permissionRows={permissionRows}
          githubRepoCapabilities={githubRepoCapabilities}
        />
      </Suspense>
    </ClientErrorBoundary>
  )
}
