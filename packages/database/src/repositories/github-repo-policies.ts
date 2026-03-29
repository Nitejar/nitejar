import { getDb } from '../db'
import {
  parseGitHubRepoCapabilities,
  serializeGitHubRepoCapabilities,
  type GitHubRepoCapability,
} from '../github-repo-capabilities'
import { listAgentRoleAssignments, listTeamRoleDefaults } from './policy'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

export type RoleGitHubRepoPolicy = {
  roleId: string
  githubRepoId: number
  repoFullName: string
  repoHtmlUrl: string | null
  installationAccountLogin: string | null
  capabilities: GitHubRepoCapability[]
}

export type GitHubRepoRecord = {
  githubRepoId: number
  repoFullName: string
  repoHtmlUrl: string | null
  installationAccountLogin: string | null
  installationId: number
  pluginInstanceId: string
}

export type AgentGitHubRepoAssignment = {
  agentId: string
  agentHandle: string | null
  agentName: string
  githubRepoId: number
  repoFullName: string
  repoHtmlUrl: string | null
  installationAccountLogin: string | null
  pluginInstanceId: string
  capabilities: GitHubRepoCapability[]
}

export type EffectiveGitHubRepoCapabilitySource =
  | { sourceType: 'direct_agent_assignment' }
  | { sourceType: 'agent_role'; roleId: string; roleName: string; roleSlug: string }
  | {
      sourceType: 'team_role_default'
      roleId: string
      roleName: string
      roleSlug: string
      teamId: string
      teamName: string
    }

export type EffectiveGitHubRepoCapabilities = {
  githubRepoId: number
  repoFullName: string
  repoHtmlUrl: string | null
  installationAccountLogin: string | null
  capabilities: GitHubRepoCapability[]
  sources: EffectiveGitHubRepoCapabilitySource[]
}

type RepoCapabilityAccumulator = {
  githubRepoId: number
  repoFullName: string
  repoHtmlUrl: string | null
  installationAccountLogin: string | null
  capabilities: Set<GitHubRepoCapability>
  sources: EffectiveGitHubRepoCapabilitySource[]
}

function addCapabilities(
  accumulator: RepoCapabilityAccumulator,
  rawCapabilities: string,
  source: EffectiveGitHubRepoCapabilitySource
) {
  for (const capability of parseGitHubRepoCapabilities(rawCapabilities)) {
    accumulator.capabilities.add(capability)
  }
  accumulator.sources.push(source)
}

export async function listGitHubRepos(opts?: {
  pluginInstanceId?: string
}): Promise<GitHubRepoRecord[]> {
  const db = getDb()
  let query = db
    .selectFrom('github_repos')
    .innerJoin('github_installations', 'github_installations.id', 'github_repos.installation_id')
    .select([
      'github_repos.id as github_repo_id',
      'github_repos.full_name as repo_full_name',
      'github_repos.html_url as repo_html_url',
      'github_installations.account_login as installation_account_login',
      'github_installations.installation_id as installation_id',
      'github_installations.plugin_instance_id as plugin_instance_id',
    ])
    .orderBy('github_repos.full_name', 'asc')

  if (opts?.pluginInstanceId) {
    query = query.where('github_installations.plugin_instance_id', '=', opts.pluginInstanceId)
  }

  const rows = await query.execute()
  return rows.map((row) => ({
    githubRepoId: row.github_repo_id,
    repoFullName: row.repo_full_name,
    repoHtmlUrl: row.repo_html_url,
    installationAccountLogin: row.installation_account_login,
    installationId: row.installation_id,
    pluginInstanceId: row.plugin_instance_id,
  }))
}

export async function listAgentGitHubRepoAssignments(opts?: {
  pluginInstanceId?: string
  agentId?: string
  githubRepoId?: number
}): Promise<AgentGitHubRepoAssignment[]> {
  const db = getDb()
  let query = db
    .selectFrom('agent_repo_capabilities')
    .innerJoin('agents', 'agents.id', 'agent_repo_capabilities.agent_id')
    .innerJoin('github_repos', 'github_repos.id', 'agent_repo_capabilities.github_repo_id')
    .innerJoin('github_installations', 'github_installations.id', 'github_repos.installation_id')
    .select([
      'agent_repo_capabilities.agent_id as agent_id',
      'agent_repo_capabilities.github_repo_id as github_repo_id',
      'agent_repo_capabilities.capabilities as capabilities',
      'agents.handle as agent_handle',
      'agents.name as agent_name',
      'github_repos.full_name as repo_full_name',
      'github_repos.html_url as repo_html_url',
      'github_installations.account_login as installation_account_login',
      'github_installations.plugin_instance_id as plugin_instance_id',
    ])
    .orderBy('github_repos.full_name', 'asc')
    .orderBy('agents.name', 'asc')

  if (opts?.pluginInstanceId) {
    query = query.where('github_installations.plugin_instance_id', '=', opts.pluginInstanceId)
  }
  if (opts?.agentId) {
    query = query.where('agent_repo_capabilities.agent_id', '=', opts.agentId)
  }
  if (opts?.githubRepoId) {
    query = query.where('agent_repo_capabilities.github_repo_id', '=', opts.githubRepoId)
  }

  const rows = await query.execute()
  return rows.map((row) => ({
    agentId: row.agent_id,
    agentHandle: row.agent_handle,
    agentName: row.agent_name,
    githubRepoId: row.github_repo_id,
    repoFullName: row.repo_full_name,
    repoHtmlUrl: row.repo_html_url,
    installationAccountLogin: row.installation_account_login,
    pluginInstanceId: row.plugin_instance_id,
    capabilities: parseGitHubRepoCapabilities(row.capabilities),
  }))
}

export async function replaceAgentGitHubRepoCapabilities(
  agentId: string,
  githubRepoId: number,
  capabilities: GitHubRepoCapability[]
): Promise<void> {
  const db = getDb()
  const serialized = serializeGitHubRepoCapabilities(capabilities)
  const normalized = parseGitHubRepoCapabilities(serialized)

  if (normalized.length === 0) {
    await db
      .deleteFrom('agent_repo_capabilities')
      .where('agent_id', '=', agentId)
      .where('github_repo_id', '=', githubRepoId)
      .execute()
    return
  }

  await db
    .insertInto('agent_repo_capabilities')
    .values({
      agent_id: agentId,
      github_repo_id: githubRepoId,
      capabilities: serialized,
    })
    .onConflict((oc) =>
      oc.columns(['agent_id', 'github_repo_id']).doUpdateSet({
        capabilities: serialized,
      })
    )
    .execute()
}

export async function listRoleGitHubRepoPolicies(roleId: string): Promise<RoleGitHubRepoPolicy[]> {
  const db = getDb()
  const rows = await db
    .selectFrom('role_github_repo_capabilities')
    .innerJoin('github_repos', 'github_repos.id', 'role_github_repo_capabilities.github_repo_id')
    .innerJoin('github_installations', 'github_installations.id', 'github_repos.installation_id')
    .select([
      'role_github_repo_capabilities.role_id as role_id',
      'role_github_repo_capabilities.github_repo_id as github_repo_id',
      'role_github_repo_capabilities.capabilities as capabilities',
      'github_repos.full_name as repo_full_name',
      'github_repos.html_url as repo_html_url',
      'github_installations.account_login as installation_account_login',
    ])
    .where('role_github_repo_capabilities.role_id', '=', roleId)
    .orderBy('github_repos.full_name', 'asc')
    .execute()

  return rows.map((row) => ({
    roleId: row.role_id,
    githubRepoId: row.github_repo_id,
    repoFullName: row.repo_full_name,
    repoHtmlUrl: row.repo_html_url,
    installationAccountLogin: row.installation_account_login,
    capabilities: parseGitHubRepoCapabilities(row.capabilities),
  }))
}

export async function replaceRoleGitHubRepoPolicies(
  roleId: string,
  policies: Array<{ githubRepoId: number; capabilities: GitHubRepoCapability[] }>
): Promise<void> {
  const db = getDb()
  const timestamp = now()

  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('role_github_repo_capabilities').where('role_id', '=', roleId).execute()

    const normalized = policies
      .map((policy) => ({
        role_id: roleId,
        github_repo_id: policy.githubRepoId,
        capabilities: serializeGitHubRepoCapabilities(policy.capabilities),
        created_at: timestamp,
        updated_at: timestamp,
      }))
      .filter((policy) => parseGitHubRepoCapabilities(policy.capabilities).length > 0)

    if (normalized.length === 0) return
    await trx.insertInto('role_github_repo_capabilities').values(normalized).execute()
  })
}

export async function listEffectiveGitHubRepoCapabilities(
  agentId: string
): Promise<EffectiveGitHubRepoCapabilities[]> {
  const db = getDb()
  const accumulators = new Map<number, RepoCapabilityAccumulator>()

  const ensureAccumulator = (row: {
    github_repo_id: number
    repo_full_name: string
    repo_html_url: string | null
    installation_account_login: string | null
  }) => {
    const existing = accumulators.get(row.github_repo_id)
    if (existing) return existing
    const next: RepoCapabilityAccumulator = {
      githubRepoId: row.github_repo_id,
      repoFullName: row.repo_full_name,
      repoHtmlUrl: row.repo_html_url,
      installationAccountLogin: row.installation_account_login,
      capabilities: new Set<GitHubRepoCapability>(),
      sources: [],
    }
    accumulators.set(row.github_repo_id, next)
    return next
  }

  const directRows = await db
    .selectFrom('agent_repo_capabilities')
    .innerJoin('github_repos', 'github_repos.id', 'agent_repo_capabilities.github_repo_id')
    .innerJoin('github_installations', 'github_installations.id', 'github_repos.installation_id')
    .select([
      'agent_repo_capabilities.github_repo_id as github_repo_id',
      'agent_repo_capabilities.capabilities as capabilities',
      'github_repos.full_name as repo_full_name',
      'github_repos.html_url as repo_html_url',
      'github_installations.account_login as installation_account_login',
    ])
    .where('agent_repo_capabilities.agent_id', '=', agentId)
    .execute()

  for (const row of directRows) {
    addCapabilities(ensureAccumulator(row), row.capabilities, {
      sourceType: 'direct_agent_assignment',
    })
  }

  const assignedRoles = await listAgentRoleAssignments(agentId)
  for (const assignment of assignedRoles) {
    const rows = await db
      .selectFrom('role_github_repo_capabilities')
      .innerJoin('github_repos', 'github_repos.id', 'role_github_repo_capabilities.github_repo_id')
      .innerJoin('github_installations', 'github_installations.id', 'github_repos.installation_id')
      .select([
        'role_github_repo_capabilities.github_repo_id as github_repo_id',
        'role_github_repo_capabilities.capabilities as capabilities',
        'github_repos.full_name as repo_full_name',
        'github_repos.html_url as repo_html_url',
        'github_installations.account_login as installation_account_login',
      ])
      .where('role_github_repo_capabilities.role_id', '=', assignment.role.id)
      .execute()

    for (const row of rows) {
      addCapabilities(ensureAccumulator(row), row.capabilities, {
        sourceType: 'agent_role',
        roleId: assignment.role.id,
        roleName: assignment.role.name,
        roleSlug: assignment.role.slug,
      })
    }
  }

  const teamRows = await db
    .selectFrom('agent_teams')
    .innerJoin('teams', 'teams.id', 'agent_teams.team_id')
    .select(['teams.id', 'teams.name'])
    .where('agent_teams.agent_id', '=', agentId)
    .execute()

  for (const team of teamRows) {
    const defaults = await listTeamRoleDefaults(team.id)
    for (const assignment of defaults) {
      const rows = await db
        .selectFrom('role_github_repo_capabilities')
        .innerJoin(
          'github_repos',
          'github_repos.id',
          'role_github_repo_capabilities.github_repo_id'
        )
        .innerJoin(
          'github_installations',
          'github_installations.id',
          'github_repos.installation_id'
        )
        .select([
          'role_github_repo_capabilities.github_repo_id as github_repo_id',
          'role_github_repo_capabilities.capabilities as capabilities',
          'github_repos.full_name as repo_full_name',
          'github_repos.html_url as repo_html_url',
          'github_installations.account_login as installation_account_login',
        ])
        .where('role_github_repo_capabilities.role_id', '=', assignment.role.id)
        .execute()

      for (const row of rows) {
        addCapabilities(ensureAccumulator(row), row.capabilities, {
          sourceType: 'team_role_default',
          roleId: assignment.role.id,
          roleName: assignment.role.name,
          roleSlug: assignment.role.slug,
          teamId: team.id,
          teamName: team.name,
        })
      }
    }
  }

  return [...accumulators.values()]
    .map((entry) => ({
      githubRepoId: entry.githubRepoId,
      repoFullName: entry.repoFullName,
      repoHtmlUrl: entry.repoHtmlUrl,
      installationAccountLogin: entry.installationAccountLogin,
      capabilities: [...entry.capabilities].sort(),
      sources: entry.sources,
    }))
    .sort((a, b) => a.repoFullName.localeCompare(b.repoFullName))
}

export async function resolveEffectiveGitHubRepoCapabilities(
  agentId: string,
  githubRepoId: number
): Promise<GitHubRepoCapability[]> {
  const repos = await listEffectiveGitHubRepoCapabilities(agentId)
  return repos.find((repo) => repo.githubRepoId === githubRepoId)?.capabilities ?? []
}
