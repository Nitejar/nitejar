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

export async function listRoleGitHubRepoPolicies(roleId: string): Promise<RoleGitHubRepoPolicy[]> {
  const db = getDb()
  const rows = await db
    .selectFrom('role_github_repo_capabilities')
    .innerJoin('github_repos', 'github_repos.id', 'role_github_repo_capabilities.github_repo_id')
    .innerJoin(
      'github_installations',
      'github_installations.id',
      'github_repos.installation_id'
    )
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
    .innerJoin(
      'github_installations',
      'github_installations.id',
      'github_repos.installation_id'
    )
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
    addCapabilities(ensureAccumulator(row), row.capabilities, { sourceType: 'direct_agent_assignment' })
  }

  const assignedRoles = await listAgentRoleAssignments(agentId)
  for (const assignment of assignedRoles) {
    const rows = await db
      .selectFrom('role_github_repo_capabilities')
      .innerJoin('github_repos', 'github_repos.id', 'role_github_repo_capabilities.github_repo_id')
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
        .innerJoin('github_repos', 'github_repos.id', 'role_github_repo_capabilities.github_repo_id')
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
