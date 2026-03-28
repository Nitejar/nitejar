import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '../db'
import {
  assignDefaultRoleToTeam,
  assignRoleToAgent,
  createRole,
  listAgentGitHubRepoAssignments,
  listEffectiveGitHubRepoCapabilities,
  listGitHubRepos,
  listRoleGitHubRepoPolicies,
  replaceAgentGitHubRepoCapabilities,
  replaceRoleGitHubRepoPolicies,
  resolveEffectiveGitHubRepoCapabilities,
} from './index'

let testDir = ''
let db: ReturnType<typeof getDb>

async function createTestSchema(database: ReturnType<typeof getDb>): Promise<void> {
  await database.schema
    .createTable('roles')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('slug', 'text', (col) => col.notNull().unique())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('charter', 'text')
    .addColumn('escalation_posture', 'text')
    .addColumn('active', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('agents')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('handle', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('sprite_id', 'text')
    .addColumn('config', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('idle'))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('teams')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('parent_team_id', 'text')
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('charter', 'text')
    .addColumn('slug', 'text')
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('lead_kind', 'text')
    .addColumn('lead_ref', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('agent_role_assignments')
    .ifNotExists()
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('role_id', 'text', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('agent_role_assignments_pk', ['agent_id', 'role_id'])
    .execute()

  await database.schema
    .createTable('agent_teams')
    .ifNotExists()
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('team_id', 'text', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('agent_teams_pk', ['agent_id', 'team_id'])
    .execute()

  await database.schema
    .createTable('team_role_defaults')
    .ifNotExists()
    .addColumn('team_id', 'text', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('role_id', 'text', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('team_role_defaults_pk', ['team_id', 'role_id'])
    .execute()

  await database.schema
    .createTable('github_installations')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('installation_id', 'integer', (col) => col.notNull())
    .addColumn('account_login', 'text')
    .addColumn('account_id', 'integer')
    .addColumn('plugin_instance_id', 'text', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('github_repos')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('repo_id', 'integer', (col) => col.notNull())
    .addColumn('full_name', 'text', (col) => col.notNull())
    .addColumn('html_url', 'text')
    .addColumn('installation_id', 'integer', (col) =>
      col.notNull().references('github_installations.id').onDelete('cascade')
    )
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('agent_repo_capabilities')
    .ifNotExists()
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('github_repo_id', 'integer', (col) =>
      col.notNull().references('github_repos.id').onDelete('cascade')
    )
    .addColumn('capabilities', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('agent_repo_capabilities_pk', ['agent_id', 'github_repo_id'])
    .execute()

  await database.schema
    .createTable('role_github_repo_capabilities')
    .ifNotExists()
    .addColumn('role_id', 'text', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addColumn('github_repo_id', 'integer', (col) =>
      col.notNull().references('github_repos.id').onDelete('cascade')
    )
    .addColumn('capabilities', 'text', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('role_github_repo_capabilities_pk', ['role_id', 'github_repo_id'])
    .execute()
}

async function clearTables(): Promise<void> {
  await db.deleteFrom('role_github_repo_capabilities').execute()
  await db.deleteFrom('agent_repo_capabilities').execute()
  await db.deleteFrom('github_repos').execute()
  await db.deleteFrom('github_installations').execute()
  await db.deleteFrom('team_role_defaults').execute()
  await db.deleteFrom('agent_teams').execute()
  await db.deleteFrom('agent_role_assignments').execute()
  await db.deleteFrom('teams').execute()
  await db.deleteFrom('agents').execute()
  await db.deleteFrom('roles').execute()
}

async function seedBaseRows(): Promise<void> {
  await db
    .insertInto('agents')
    .values({
      id: 'agent-1',
      handle: 'agent-one',
      name: 'Agent One',
      sprite_id: null,
      config: null,
      status: 'idle',
      created_at: 1,
      updated_at: 1,
    })
    .execute()

  await db
    .insertInto('teams')
    .values({
      id: 'team-1',
      parent_team_id: null,
      name: 'Ops',
      charter: null,
      slug: 'ops',
      sort_order: 0,
      lead_kind: null,
      lead_ref: null,
      created_at: 1,
      updated_at: 1,
    })
    .execute()

  await db
    .insertInto('github_installations')
    .values({
      id: 1,
      installation_id: 101,
      account_login: 'nitejar',
      account_id: 500,
      plugin_instance_id: 'plugin-1',
      created_at: 1,
      updated_at: 1,
    })
    .execute()

  await db
    .insertInto('github_repos')
    .values([
      {
        id: 11,
        repo_id: 1001,
        full_name: 'nitejar/core',
        html_url: 'https://github.com/nitejar/core',
        installation_id: 1,
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 12,
        repo_id: 1002,
        full_name: 'nitejar/web',
        html_url: 'https://github.com/nitejar/web',
        installation_id: 1,
        created_at: 1,
        updated_at: 1,
      },
    ])
    .execute()
}

describe('github repo policy repository', () => {
  const originalDbUrl = process.env.DATABASE_URL

  beforeAll(async () => {
    await closeDb()
    testDir = mkdtempSync(join(tmpdir(), 'nitejar-github-policy-'))
    process.env.DATABASE_URL = join(testDir, 'test.sqlite')
    db = getDb()
    await createTestSchema(db)
  })

  afterAll(async () => {
    await closeDb()
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl
    else delete process.env.DATABASE_URL
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await clearTables()
    await seedBaseRows()
  })

  it('lists role-level github repo policies with repo metadata', async () => {
    const role = await createRole({
      slug: 'reviewer',
      name: 'Reviewer',
      charter: null,
      escalation_posture: null,
      active: 1,
    })

    await replaceRoleGitHubRepoPolicies(role.id, [
      { githubRepoId: 11, capabilities: ['read_repo', 'review_pr'] },
    ])

    await expect(listRoleGitHubRepoPolicies(role.id)).resolves.toEqual([
      {
        roleId: role.id,
        githubRepoId: 11,
        repoFullName: 'nitejar/core',
        repoHtmlUrl: 'https://github.com/nitejar/core',
        installationAccountLogin: 'nitejar',
        capabilities: ['read_repo', 'review_pr'],
      },
    ])
  })

  it('lists repos and direct agent github repo assignments', async () => {
    await db
      .insertInto('agent_repo_capabilities')
      .values({
        agent_id: 'agent-1',
        github_repo_id: 11,
        capabilities: JSON.stringify(['read_repo', 'comment']),
      })
      .execute()

    await expect(listGitHubRepos({ pluginInstanceId: 'plugin-1' })).resolves.toEqual([
      {
        githubRepoId: 11,
        repoFullName: 'nitejar/core',
        repoHtmlUrl: 'https://github.com/nitejar/core',
        installationAccountLogin: 'nitejar',
        installationId: 101,
        pluginInstanceId: 'plugin-1',
      },
      {
        githubRepoId: 12,
        repoFullName: 'nitejar/web',
        repoHtmlUrl: 'https://github.com/nitejar/web',
        installationAccountLogin: 'nitejar',
        installationId: 101,
        pluginInstanceId: 'plugin-1',
      },
    ])

    await expect(listAgentGitHubRepoAssignments({ pluginInstanceId: 'plugin-1' })).resolves.toEqual(
      [
        {
          agentId: 'agent-1',
          agentHandle: 'agent-one',
          agentName: 'Agent One',
          githubRepoId: 11,
          repoFullName: 'nitejar/core',
          repoHtmlUrl: 'https://github.com/nitejar/core',
          installationAccountLogin: 'nitejar',
          pluginInstanceId: 'plugin-1',
          capabilities: ['comment', 'read_repo'],
        },
      ]
    )
  })

  it('upserts and removes direct agent github repo assignments', async () => {
    await replaceAgentGitHubRepoCapabilities('agent-1', 11, ['read_repo', 'open_pr'])

    await expect(listAgentGitHubRepoAssignments({ agentId: 'agent-1' })).resolves.toEqual([
      {
        agentId: 'agent-1',
        agentHandle: 'agent-one',
        agentName: 'Agent One',
        githubRepoId: 11,
        repoFullName: 'nitejar/core',
        repoHtmlUrl: 'https://github.com/nitejar/core',
        installationAccountLogin: 'nitejar',
        pluginInstanceId: 'plugin-1',
        capabilities: ['open_pr', 'read_repo'],
      },
    ])

    await replaceAgentGitHubRepoCapabilities('agent-1', 11, [])

    await expect(listAgentGitHubRepoAssignments({ agentId: 'agent-1' })).resolves.toEqual([])
  })

  it('unions direct, assigned-role, and team-default repo capabilities', async () => {
    const directRole = await createRole({
      slug: 'author',
      name: 'Author',
      charter: null,
      escalation_posture: null,
      active: 1,
    })
    const teamRole = await createRole({
      slug: 'triage',
      name: 'Triage',
      charter: null,
      escalation_posture: null,
      active: 1,
    })

    await db
      .insertInto('agent_repo_capabilities')
      .values({
        agent_id: 'agent-1',
        github_repo_id: 11,
        capabilities: JSON.stringify(['read_repo']),
      })
      .execute()

    await replaceRoleGitHubRepoPolicies(directRole.id, [
      { githubRepoId: 11, capabilities: ['open_pr'] },
      { githubRepoId: 12, capabilities: ['read_repo', 'comment'] },
    ])
    await replaceRoleGitHubRepoPolicies(teamRole.id, [
      { githubRepoId: 11, capabilities: ['merge_pr'] },
    ])

    await assignRoleToAgent('agent-1', directRole.id)
    await db
      .insertInto('agent_teams')
      .values({ agent_id: 'agent-1', team_id: 'team-1', created_at: 1 })
      .execute()
    await assignDefaultRoleToTeam('team-1', teamRole.id)

    await expect(resolveEffectiveGitHubRepoCapabilities('agent-1', 11)).resolves.toEqual([
      'merge_pr',
      'open_pr',
      'read_repo',
    ])

    const effective = await listEffectiveGitHubRepoCapabilities('agent-1')
    expect(effective).toHaveLength(2)
    expect(effective[0]).toMatchObject({
      githubRepoId: 11,
      repoFullName: 'nitejar/core',
      repoHtmlUrl: 'https://github.com/nitejar/core',
      installationAccountLogin: 'nitejar',
      capabilities: ['merge_pr', 'open_pr', 'read_repo'],
    })
    expect(effective[0]?.sources.length).toBeGreaterThan(0)
    expect(effective[1]).toMatchObject({
      githubRepoId: 12,
      repoFullName: 'nitejar/web',
      repoHtmlUrl: 'https://github.com/nitejar/web',
      installationAccountLogin: 'nitejar',
      capabilities: ['comment', 'read_repo'],
    })
    expect(effective[1]?.sources.length).toBeGreaterThan(0)
  })
})
