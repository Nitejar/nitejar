import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { buildPolicyPermissionRows } from '@nitejar/database'
import { pluginHandlerRegistry } from '@nitejar/plugin-handlers/registry'
import { ClientErrorBoundary } from '../components/ClientErrorBoundary'
import { ensureBuiltinPluginHandlersLoaded } from '@/server/services/plugins/ensure-builtin-handlers'
import { CompanyClient } from './CompanyClient'

function CompanyFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

export async function CompanyPageShell() {
  const permissionRows = buildPolicyPermissionRows()
  await ensureBuiltinPluginHandlersLoaded()
  const githubManagementConfig = pluginHandlerRegistry.get('github')?.managementConfig
  const githubRepoCapabilities =
    githubManagementConfig?.repoAccess?.kind === 'github_repo_capabilities'
      ? githubManagementConfig.repoAccess.capabilityDescriptors
      : []

  return (
    <ClientErrorBoundary label="Company">
      <Suspense fallback={<CompanyFallback />}>
        <CompanyClient
          permissionRows={permissionRows}
          githubRepoCapabilities={githubRepoCapabilities}
        />
      </Suspense>
    </ClientErrorBoundary>
  )
}
