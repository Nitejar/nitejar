import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Database from '@nitejar/database'
import type { ToolContext } from './tools'
import {
  listGitHubReposTool,
  listRoleGitHubRepoPoliciesTool,
  updateAgentGitHubRepoAssignmentTool,
  updateRoleGitHubRepoPoliciesTool,
} from './tools/handlers/github-policy'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    assertAgentGrant: vi.fn(),
    findAgentByHandle: vi.fn(),
    findAgentById: vi.fn(),
    findRoleById: vi.fn(),
    findRoleBySlug: vi.fn(),
    listAgentGitHubRepoAssignments: vi.fn(),
    listGitHubRepos: vi.fn(),
    listRoleGitHubRepoPolicies: vi.fn(),
    listRoles: vi.fn(),
    replaceAgentGitHubRepoCapabilities: vi.fn(),
    replaceRoleGitHubRepoPolicies: vi.fn(),
  }
})

const mockedAssertAgentGrant = vi.mocked(Database.assertAgentGrant)
const mockedFindAgentByHandle = vi.mocked(Database.findAgentByHandle)
const mockedFindAgentById = vi.mocked(Database.findAgentById)
const mockedFindRoleById = vi.mocked(Database.findRoleById)
const mockedFindRoleBySlug = vi.mocked(Database.findRoleBySlug)
const mockedListAgentGitHubRepoAssignments = vi.mocked(Database.listAgentGitHubRepoAssignments)
const mockedListGitHubRepos = vi.mocked(Database.listGitHubRepos)
const mockedListRoleGitHubRepoPolicies = vi.mocked(Database.listRoleGitHubRepoPolicies)
const mockedListRoles = vi.mocked(Database.listRoles)
const mockedReplaceAgentGitHubRepoCapabilities = vi.mocked(
  Database.replaceAgentGitHubRepoCapabilities
)
const mockedReplaceRoleGitHubRepoPolicies = vi.mocked(Database.replaceRoleGitHubRepoPolicies)

const baseContext: ToolContext = {
  agentId: 'agent-1',
  spriteName: 'nitejar-ceo',
}

beforeEach(() => {
  mockedAssertAgentGrant.mockReset()
  mockedFindAgentByHandle.mockReset()
  mockedFindAgentById.mockReset()
  mockedFindRoleById.mockReset()
  mockedFindRoleBySlug.mockReset()
  mockedListAgentGitHubRepoAssignments.mockReset()
  mockedListGitHubRepos.mockReset()
  mockedListRoleGitHubRepoPolicies.mockReset()
  mockedListRoles.mockReset()
  mockedReplaceAgentGitHubRepoCapabilities.mockReset()
  mockedReplaceRoleGitHubRepoPolicies.mockReset()
  mockedAssertAgentGrant.mockResolvedValue(undefined)
})

describe('github policy tools', () => {
  it('lists github repos for a plugin instance', async () => {
    mockedListGitHubRepos.mockResolvedValue([
      {
        githubRepoId: 11,
        repoFullName: 'Nitejar/nitejar',
        repoHtmlUrl: 'https://github.com/Nitejar/nitejar',
        installationAccountLogin: 'Nitejar',
        installationId: 101,
        pluginInstanceId: 'plugin-1',
      },
    ])

    const result = await listGitHubReposTool({ plugin_instance_id: 'plugin-1' }, baseContext)

    expect(result.success).toBe(true)
    expect(mockedAssertAgentGrant).toHaveBeenCalledWith({
      agentId: 'agent-1',
      action: 'github.repo.policy.read',
      resourceType: '*',
    })
    expect(result.output).toContain('Nitejar/nitejar')
  })

  it('updates a direct agent github repo assignment by handle and repo name', async () => {
    mockedFindAgentByHandle.mockResolvedValue({
      id: 'agent-2',
      handle: 'scout',
      name: 'Scout',
      sprite_id: null,
      config: null,
      status: 'idle',
      created_at: 0,
      updated_at: 0,
    })
    mockedListGitHubRepos.mockResolvedValue([
      {
        githubRepoId: 11,
        repoFullName: 'Nitejar/nitejar',
        repoHtmlUrl: 'https://github.com/Nitejar/nitejar',
        installationAccountLogin: 'Nitejar',
        installationId: 101,
        pluginInstanceId: 'plugin-1',
      },
    ])
    mockedListAgentGitHubRepoAssignments.mockResolvedValue([
      {
        agentId: 'agent-2',
        agentHandle: 'scout',
        agentName: 'Scout',
        githubRepoId: 11,
        repoFullName: 'Nitejar/nitejar',
        repoHtmlUrl: 'https://github.com/Nitejar/nitejar',
        installationAccountLogin: 'Nitejar',
        pluginInstanceId: 'plugin-1',
        capabilities: ['open_pr', 'read_repo'],
      },
    ])

    const result = await updateAgentGitHubRepoAssignmentTool(
      {
        agent_handle: 'scout',
        repo_name: 'Nitejar/nitejar',
        plugin_instance_id: 'plugin-1',
        capabilities: ['read_repo', 'open_pr'],
      },
      baseContext
    )

    expect(result.success).toBe(true)
    expect(mockedReplaceAgentGitHubRepoCapabilities).toHaveBeenCalledWith('agent-2', 11, [
      'open_pr',
      'read_repo',
    ])
    expect(result.output).toContain('"directAssignment"')
  })

  it('lists all roles with github repo policies when no role is specified', async () => {
    mockedListRoles.mockResolvedValue([
      {
        id: 'role-1',
        slug: 'engineer',
        name: 'Engineer',
        charter: null,
        escalation_posture: null,
        active: 1,
        created_at: 0,
        updated_at: 0,
      },
      {
        id: 'role-2',
        slug: 'empty',
        name: 'Empty',
        charter: null,
        escalation_posture: null,
        active: 1,
        created_at: 0,
        updated_at: 0,
      },
    ])
    mockedListRoleGitHubRepoPolicies
      .mockResolvedValueOnce([
        {
          roleId: 'role-1',
          githubRepoId: 11,
          repoFullName: 'Nitejar/nitejar',
          repoHtmlUrl: 'https://github.com/Nitejar/nitejar',
          installationAccountLogin: 'Nitejar',
          capabilities: ['read_repo'],
        },
      ])
      .mockResolvedValueOnce([])

    const result = await listRoleGitHubRepoPoliciesTool({}, baseContext)

    expect(result.success).toBe(true)
    expect(result.output).toContain('"Engineer"')
    expect(result.output).not.toContain('"Empty"')
  })

  it('replaces role github repo policies by role slug', async () => {
    mockedFindRoleBySlug.mockResolvedValue({
      id: 'role-1',
      slug: 'engineer',
      name: 'Engineer',
      charter: null,
      escalation_posture: null,
      active: 1,
      created_at: 0,
      updated_at: 0,
    })
    mockedListGitHubRepos.mockResolvedValue([
      {
        githubRepoId: 11,
        repoFullName: 'Nitejar/nitejar',
        repoHtmlUrl: 'https://github.com/Nitejar/nitejar',
        installationAccountLogin: 'Nitejar',
        installationId: 101,
        pluginInstanceId: 'plugin-1',
      },
    ])
    mockedListRoleGitHubRepoPolicies.mockResolvedValue([
      {
        roleId: 'role-1',
        githubRepoId: 11,
        repoFullName: 'Nitejar/nitejar',
        repoHtmlUrl: 'https://github.com/Nitejar/nitejar',
        installationAccountLogin: 'Nitejar',
        capabilities: ['comment', 'read_repo'],
      },
    ])

    const result = await updateRoleGitHubRepoPoliciesTool(
      {
        role_slug: 'engineer',
        plugin_instance_id: 'plugin-1',
        policies: [
          {
            repo_name: 'Nitejar/nitejar',
            capabilities: ['read_repo', 'comment'],
          },
        ],
      },
      baseContext
    )

    expect(result.success).toBe(true)
    expect(mockedReplaceRoleGitHubRepoPolicies).toHaveBeenCalledWith('role-1', [
      { githubRepoId: 11, capabilities: ['comment', 'read_repo'] },
    ])
    expect(result.output).toContain('"policies"')
  })
})
