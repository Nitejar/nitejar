import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Database from '@nitejar/database'
import type { ToolContext } from './tools'
import {
  listGitHubReposTool,
  listGitHubRepoAssignmentsTool,
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

    const missingIdentity = await listGitHubReposTool(
      { plugin_instance_id: 'plugin-1' },
      { ...baseContext, agentId: undefined }
    )
    expect(missingIdentity.success).toBe(false)
    expect(missingIdentity.error).toBe('Missing agent identity.')
  })

  it('lists direct github repo assignments and requires agent identity', async () => {
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
        capabilities: ['read_repo'],
      },
    ])

    const listed = await listGitHubRepoAssignmentsTool({}, baseContext)
    expect(listed.success).toBe(true)
    expect(listed.output).toContain('"assignments"')

    const missingIdentity = await listGitHubRepoAssignmentsTool(
      {},
      { ...baseContext, agentId: undefined }
    )
    expect(missingIdentity.success).toBe(false)
    expect(missingIdentity.error).toBe('Missing agent identity.')

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

    const filtered = await listGitHubRepoAssignmentsTool(
      {
        plugin_instance_id: 'plugin-1',
        agent_handle: 'scout',
        repo_name: 'Nitejar/nitejar',
      },
      baseContext
    )
    expect(filtered.success).toBe(true)
    expect(mockedListAgentGitHubRepoAssignments).toHaveBeenLastCalledWith({
      pluginInstanceId: 'plugin-1',
      agentId: 'agent-2',
      githubRepoId: 11,
    })
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

  it('rejects bad agent assignment inputs and ambiguous repo matches', async () => {
    mockedFindAgentById.mockResolvedValue({
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
      {
        githubRepoId: 12,
        repoFullName: 'Nitejar/nitejar',
        repoHtmlUrl: 'https://github.com/Nitejar/nitejar-2',
        installationAccountLogin: 'Nitejar',
        installationId: 102,
        pluginInstanceId: 'plugin-2',
      },
    ])

    const badCapability = await updateAgentGitHubRepoAssignmentTool(
      {
        agent_id: 'agent-2',
        github_repo_id: 11,
        capabilities: ['not-real'],
      },
      baseContext
    )
    expect(badCapability.success).toBe(false)
    expect(badCapability.error).toContain('valid GitHub repo capabilities')

    const ambiguousRepo = await updateAgentGitHubRepoAssignmentTool(
      {
        agent_id: 'agent-2',
        repo_name: 'Nitejar/nitejar',
        capabilities: ['read_repo'],
      },
      baseContext
    )
    expect(ambiguousRepo.success).toBe(false)
    expect(ambiguousRepo.error).toContain('Multiple repositories matched repo_name')

    const missingAgentSelector = await updateAgentGitHubRepoAssignmentTool(
      {
        github_repo_id: 11,
        capabilities: ['read_repo'],
      },
      baseContext
    )
    expect(missingAgentSelector.success).toBe(false)
    expect(missingAgentSelector.error).toContain('agent_id or agent_handle is required.')

    const missingRepoSelector = await updateAgentGitHubRepoAssignmentTool(
      {
        agent_id: 'agent-2',
        capabilities: ['read_repo'],
      },
      baseContext
    )
    expect(missingRepoSelector.success).toBe(false)
    expect(missingRepoSelector.error).toContain('repo_name or github_repo_id is required.')
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

  it('lists role policies for one role and validates update inputs', async () => {
    mockedFindRoleById.mockResolvedValue({
      id: 'role-1',
      slug: 'engineer',
      name: 'Engineer',
      charter: null,
      escalation_posture: null,
      active: 1,
      created_at: 0,
      updated_at: 0,
    })
    mockedListRoleGitHubRepoPolicies.mockResolvedValue([
      {
        roleId: 'role-1',
        githubRepoId: 11,
        repoFullName: 'Nitejar/nitejar',
        repoHtmlUrl: 'https://github.com/Nitejar/nitejar',
        installationAccountLogin: 'Nitejar',
        capabilities: ['read_repo'],
      },
    ])

    const listed = await listRoleGitHubRepoPoliciesTool({ role_id: 'role-1' }, baseContext)
    expect(listed.success).toBe(true)
    expect(listed.output).toContain('"role"')
    expect(listed.output).toContain('"Engineer"')

    const missingIdentity = await listRoleGitHubRepoPoliciesTool(
      { role_id: 'role-1' },
      { ...baseContext, agentId: undefined }
    )
    expect(missingIdentity.success).toBe(false)
    expect(missingIdentity.error).toBe('Missing agent identity.')

    const missingRoleSelector = await updateRoleGitHubRepoPoliciesTool(
      {
        policies: [],
      },
      baseContext
    )
    expect(missingRoleSelector.success).toBe(false)
    expect(missingRoleSelector.error).toContain('role_id or role_slug is required.')

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

    const badCapabilities = await updateRoleGitHubRepoPoliciesTool(
      {
        role_id: 'role-1',
        policies: [{ github_repo_id: 11, capabilities: ['bogus'] }],
      },
      baseContext
    )
    expect(badCapabilities.success).toBe(false)
    expect(badCapabilities.error).toContain('valid GitHub repo capabilities')

    const missingPolicies = await updateRoleGitHubRepoPoliciesTool(
      {
        role_id: 'role-1',
      },
      baseContext
    )
    expect(missingPolicies.success).toBe(false)
    expect(missingPolicies.error).toContain('policies is required.')

    const badPolicyRow = await updateRoleGitHubRepoPoliciesTool(
      {
        role_id: 'role-1',
        policies: ['bad-row'],
      },
      baseContext
    )
    expect(badPolicyRow.success).toBe(false)
    expect(badPolicyRow.error).toContain('policies[0] must be an object.')
  })
})
