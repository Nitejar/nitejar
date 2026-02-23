import type Anthropic from '@anthropic-ai/sdk'
import { getDb } from '@nitejar/database'
import { refreshSpriteNetworkPolicy, writeFile } from '@nitejar/sprites'
import { getGitHubAppConfig, GitHubCredentialProvider } from '@nitejar/plugin-handlers'
import { runSpriteCommand } from '../helpers'
import type { ToolHandler } from '../types'

export const configureGitHubCredentialsDefinition: Anthropic.Tool = {
  name: 'configure_github_credentials',
  description:
    'Mint a short-lived GitHub App token for a repo and configure GH_TOKEN/GITHUB_TOKEN plus git credential helper in the sandbox.',
  input_schema: {
    type: 'object' as const,
    properties: {
      repo_name: {
        type: 'string',
        description:
          'GitHub repository full name (owner/repo). Optional if only one repo is authorized.',
      },
      duration: {
        type: 'integer',
        description: 'Token TTL in seconds (optional).',
      },
    },
  },
}

type GitHubPermissionLevel = 'read' | 'write' | 'admin'
type GitHubPermissionMap = Record<string, GitHubPermissionLevel>

type RepoRecord = {
  github_repo_id: number
  repo_id: number
  installation_id: number
  plugin_instance_id: string
}

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

function mapCapabilitiesToPermissions(capabilities: string[]): GitHubPermissionMap {
  const permissions: GitHubPermissionMap = {}
  const caps = new Set(capabilities)
  const hasPrLifecycleCapability =
    caps.has('open_pr') ||
    caps.has('request_review') ||
    caps.has('review_pr') ||
    caps.has('merge_pr')

  if (caps.has('read_repo')) {
    setPermission(permissions, 'contents', 'read')
  }
  if (caps.has('create_branch') || caps.has('push_branch')) {
    setPermission(permissions, 'contents', 'write')
  }
  if (hasPrLifecycleCapability) {
    setPermission(permissions, 'pull_requests', 'write')
    // PR status visibility needs check-runs and workflow-run read access.
    setPermission(permissions, 'checks', 'read')
    setPermission(permissions, 'actions', 'read')
  }
  if (caps.has('comment') || caps.has('label_issue_pr')) {
    setPermission(permissions, 'issues', 'write')
  }

  return permissions
}

async function resolveRepoRecord(
  repoName: string | undefined,
  agentId: string
): Promise<{ repoRecord?: RepoRecord; error?: string }> {
  const db = getDb()

  if (repoName) {
    const repoRecord = await db
      .selectFrom('github_repos')
      .innerJoin('github_installations', 'github_installations.id', 'github_repos.installation_id')
      .select([
        'github_repos.id as github_repo_id',
        'github_repos.repo_id as repo_id',
        'github_installations.installation_id as installation_id',
        'github_installations.plugin_instance_id as plugin_instance_id',
      ])
      .where('github_repos.full_name', '=', repoName)
      .executeTakeFirst()

    return repoRecord ? { repoRecord } : { error: 'GitHub repository not found.' }
  }

  const candidates = await db
    .selectFrom('agent_repo_capabilities')
    .innerJoin('github_repos', 'github_repos.id', 'agent_repo_capabilities.github_repo_id')
    .innerJoin('github_installations', 'github_installations.id', 'github_repos.installation_id')
    .select([
      'github_repos.id as github_repo_id',
      'github_repos.repo_id as repo_id',
      'github_installations.installation_id as installation_id',
      'github_installations.plugin_instance_id as plugin_instance_id',
    ])
    .where('agent_repo_capabilities.agent_id', '=', agentId)
    .execute()

  if (candidates.length === 1) {
    return { repoRecord: candidates[0] }
  }

  if (candidates.length > 1) {
    return {
      error: 'Multiple repositories available. Provide repo_name to select one.',
    }
  }

  return { error: 'GitHub repository not found.' }
}

async function loadGrantedCapabilities(agentId: string, githubRepoId: number): Promise<string[]> {
  const db = getDb()
  const capabilityRow = await db
    .selectFrom('agent_repo_capabilities')
    .select(['capabilities'])
    .where('agent_id', '=', agentId)
    .where('github_repo_id', '=', githubRepoId)
    .executeTakeFirst()

  if (!capabilityRow?.capabilities) {
    return []
  }

  try {
    const parsed = JSON.parse(capabilityRow.capabilities) as string[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export const configureGitHubCredentialsTool: ToolHandler = async (input, context) => {
  const repoName = (input.repo_name as string | undefined)?.trim()
  const duration = input.duration as number | undefined

  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity for credential configuration.' }
  }

  const db = getDb()
  const { repoRecord, error: repoError } = await resolveRepoRecord(repoName, context.agentId)
  if (!repoRecord) {
    return { success: false, error: repoError ?? 'GitHub repository not found.' }
  }

  const grantedCapabilities = await loadGrantedCapabilities(
    context.agentId,
    repoRecord.github_repo_id
  )
  const scopedPermissions = mapCapabilitiesToPermissions(grantedCapabilities)
  const allowed = grantedCapabilities.length > 0 && Object.keys(scopedPermissions).length > 0

  const auditId = crypto.randomUUID()
  const timestamp = Math.floor(Date.now() / 1000)
  await db
    .insertInto('audit_logs')
    .values({
      id: auditId,
      event_type: allowed ? 'CAPABILITY_CHECK_PASS' : 'CAPABILITY_CHECK_FAIL',
      agent_id: context.agentId,
      github_repo_id: repoRecord.github_repo_id,
      capability: 'github_token',
      result: allowed ? 'allowed' : 'denied',
      metadata: JSON.stringify({
        requestedCapability: 'github_token',
        allowed,
        capabilities: grantedCapabilities,
        permissions: scopedPermissions,
      }),
      created_at: timestamp,
    })
    .execute()

  if (!allowed) {
    return {
      success: false,
      error: 'Access denied: no scoped capabilities configured for this repository.',
    }
  }

  if (!context.session) {
    return {
      success: false,
      error:
        'No active sprite session available for configuring credentials. ' +
        'Retry after the session is re-established.',
      _meta: { sessionError: true },
    }
  }

  let policySummary = 'unknown'
  try {
    const refreshed = await refreshSpriteNetworkPolicy(context.spriteName, {
      fallbackPreset: 'development',
    })
    policySummary =
      `${refreshed.source}` +
      `${refreshed.preset ? `/${refreshed.preset}` : ''}` +
      ` (${refreshed.policy.rules.length} rules)`
  } catch (error) {
    const policyError = error instanceof Error ? error.message : String(error)
    policySummary = `refresh_failed (${policyError})`
    console.warn('[AgentTool] Failed to refresh sprite network policy', {
      agentId: context.agentId,
      spriteName: context.spriteName,
      policyError,
    })
  }

  const provider = new GitHubCredentialProvider({
    pluginInstanceId: repoRecord.plugin_instance_id,
    tokenTtlSeconds: duration,
  })

  let credential: Awaited<ReturnType<typeof provider.getCredential>>
  try {
    credential = await provider.getCredential({
      installationId: repoRecord.installation_id,
      repositoryIds: [repoRecord.repo_id],
      permissions: scopedPermissions,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const pluginInstanceConfig = await getGitHubAppConfig(repoRecord.plugin_instance_id)
    const configuredPreset = pluginInstanceConfig?.permissions?.preset ?? 'unset'

    console.warn('[AgentTool] Failed to configure GitHub credentials', {
      agentId: context.agentId,
      repoName: repoName ?? null,
      pluginInstanceId: repoRecord.plugin_instance_id,
      installationId: repoRecord.installation_id,
      repoId: repoRecord.repo_id,
      configuredPreset,
      requestedPermissions: scopedPermissions,
      errorMessage,
    })

    await db
      .insertInto('audit_logs')
      .values({
        id: crypto.randomUUID(),
        event_type: 'TOKEN_MINT_FAIL',
        agent_id: context.agentId,
        github_repo_id: repoRecord.github_repo_id,
        capability: 'github_token',
        result: 'denied',
        metadata: JSON.stringify({
          allowed,
          capabilities: grantedCapabilities,
          requestedPermissions: scopedPermissions,
          pluginInstanceId: repoRecord.plugin_instance_id,
          installationId: repoRecord.installation_id,
          configuredPreset,
          error: errorMessage,
        }),
        created_at: Math.floor(Date.now() / 1000),
      })
      .execute()

    const scopeHint = errorMessage.includes('permissions requested are not granted')
      ? ` GitHub App installation lacks required scopes for requested permissions (${Object.entries(
          scopedPermissions
        )
          .map(([name, level]) => `${name}:${level}`)
          .join(
            ', '
          )}). Current plugin instance preset: ${configuredPreset}. Update the GitHub App repository permissions (at minimum contents:read for clone access), then re-approve or reinstall the app for ${repoName ?? 'the target repository'} and run installation sync before retrying.`
      : ''

    return {
      success: false,
      error: `Failed to mint GitHub token.${scopeHint} Original error: ${errorMessage}`,
    }
  }

  const homeDir = '/home/sprite'
  const nitejarDir = `${homeDir}/.nitejar`
  const envPath = `${nitejarDir}/env`
  const helperPath = `${nitejarDir}/git-credential-helper`

  await runSpriteCommand(context, `mkdir -p ${nitejarDir}`, homeDir)

  const envContent = `export GH_TOKEN=${credential.token}\nexport GITHUB_TOKEN=${credential.token}\n`
  await writeFile(context.spriteName, envPath, envContent)

  const helperContent = [
    '#!/bin/sh',
    'if [ -z "$GH_TOKEN" ]; then',
    '  exit 1',
    'fi',
    'echo "username=x-access-token"',
    'echo "password=$GH_TOKEN"',
    '',
  ].join('\n')

  await writeFile(context.spriteName, helperPath, helperContent)

  await runSpriteCommand(context, `chmod 700 ${helperPath} && chmod 600 ${envPath}`, homeDir)

  const sourceLine = 'if [ -f ~/.nitejar/env ]; then . ~/.nitejar/env; fi'
  const ensureSourceCmd =
    `grep -q "${sourceLine}" ~/.bashrc || echo "${sourceLine}" >> ~/.bashrc; ` +
    `grep -q "${sourceLine}" ~/.profile || echo "${sourceLine}" >> ~/.profile`

  await runSpriteCommand(context, ensureSourceCmd, homeDir)
  await runSpriteCommand(context, sourceLine, homeDir)

  await runSpriteCommand(context, `git config --global credential.helper "${helperPath}"`, homeDir)

  return {
    success: true,
    output: `GitHub credentials configured for gh and git. Network policy: ${policySummary}.`,
  }
}
