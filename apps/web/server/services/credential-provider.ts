import {
  GitHubCredentialProvider,
  type GitHubCredentialRequest,
  type CredentialEnvelope,
  type ICredentialProvider,
} from '@nitejar/plugin-handlers'
import { getDb } from '@nitejar/database'
import { CapabilityService } from './capability'

export { GitHubCredentialProvider }
export type { GitHubCredentialRequest, CredentialEnvelope, ICredentialProvider }

type GitHubPermissionLevel = 'read' | 'write' | 'admin'
type GitHubPermissionMap = Record<string, GitHubPermissionLevel>

const PERMISSION_LEVEL_ORDER: Record<GitHubPermissionLevel, number> = {
  read: 1,
  write: 2,
  admin: 3,
}

function setPermission(
  permissions: GitHubPermissionMap,
  name: string,
  level: GitHubPermissionLevel
): void {
  const current = permissions[name]
  if (!current || PERMISSION_LEVEL_ORDER[level] > PERMISSION_LEVEL_ORDER[current]) {
    permissions[name] = level
  }
}

function mapCapabilityToPermissions(capability: string): GitHubPermissionMap {
  const permissions: GitHubPermissionMap = {}

  switch (capability) {
    case 'read_repo':
      setPermission(permissions, 'contents', 'read')
      break
    case 'create_branch':
    case 'push_branch':
      setPermission(permissions, 'contents', 'write')
      break
    case 'open_pr':
    case 'request_review':
    case 'review_pr':
    case 'merge_pr':
      setPermission(permissions, 'pull_requests', 'write')
      setPermission(permissions, 'checks', 'read')
      setPermission(permissions, 'actions', 'read')
      break
    case 'comment':
    case 'label_issue_pr':
      setPermission(permissions, 'issues', 'write')
      break
    default:
      break
  }

  return permissions
}

export async function getGitHubRepoToken(params: {
  agentId: string
  githubRepoId: number
  capability: string
}): Promise<CredentialEnvelope> {
  const db = getDb()

  await CapabilityService.assertCapability(params.agentId, params.githubRepoId, params.capability)

  const repo = await db
    .selectFrom('github_repos')
    .innerJoin('github_installations', 'github_installations.id', 'github_repos.installation_id')
    .select([
      'github_repos.repo_id as repo_id',
      'github_installations.installation_id as installation_id',
      'github_installations.plugin_instance_id as plugin_instance_id',
    ])
    .where('github_repos.id', '=', params.githubRepoId)
    .executeTakeFirst()

  if (!repo) {
    throw new Error('GitHub repo not found')
  }

  const provider = new GitHubCredentialProvider({
    pluginInstanceId: repo.plugin_instance_id,
  })

  const permissions = mapCapabilityToPermissions(params.capability)
  if (Object.keys(permissions).length === 0) {
    throw new Error('Access denied: capability does not map to GitHub permissions')
  }

  return provider.getCredential({
    installationId: repo.installation_id,
    repositoryIds: [repo.repo_id],
    permissions,
  })
}
