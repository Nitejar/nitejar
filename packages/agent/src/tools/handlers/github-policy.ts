import type Anthropic from '@anthropic-ai/sdk'
import {
  GITHUB_REPO_CAPABILITY_IDS,
  assertAgentGrant,
  findAgentByHandle,
  findAgentById,
  findRoleById,
  findRoleBySlug,
  isGitHubRepoCapability,
  listAgentGitHubRepoAssignments,
  listGitHubRepos,
  listRoleGitHubRepoPolicies,
  listRoles,
  replaceAgentGitHubRepoCapabilities,
  replaceRoleGitHubRepoPolicies,
} from '@nitejar/database'
import type { GitHubRepoCapability } from '@nitejar/database'
import type { ToolHandler } from '../types'

function toJsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

function requireAgentId(context: { agentId?: string }): string {
  if (!context.agentId) {
    throw new Error('Missing agent identity.')
  }
  return context.agentId
}

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function parseCapabilities(
  input: Record<string, unknown>,
  key = 'capabilities',
  label = key
): GitHubRepoCapability[] {
  const value = input[key]
  if (!Array.isArray(value)) return []
  const next = new Set<GitHubRepoCapability>()
  for (const entry of value) {
    if (typeof entry !== 'string' || !isGitHubRepoCapability(entry)) {
      throw new Error(
        `${label} entries must be valid GitHub repo capabilities: ${GITHUB_REPO_CAPABILITY_IDS.join(', ')}.`
      )
    }
    next.add(entry)
  }
  return [...next].sort()
}

async function assertGitHubRepoPolicyGrant(actorAgentId: string, action: string) {
  await assertAgentGrant({
    agentId: actorAgentId,
    action,
    resourceType: '*',
  })
}

async function resolveRepoRecord(input: {
  githubRepoId?: number
  repoName?: string
  pluginInstanceId?: string
}) {
  const repos = await listGitHubRepos(
    input.pluginInstanceId ? { pluginInstanceId: input.pluginInstanceId } : undefined
  )
  if (input.githubRepoId !== undefined) {
    const repo = repos.find((candidate) => candidate.githubRepoId === input.githubRepoId)
    if (!repo) throw new Error('GitHub repository not found.')
    return repo
  }

  if (!input.repoName) {
    throw new Error('repo_name or github_repo_id is required.')
  }

  const matches = repos.filter((candidate) => candidate.repoFullName === input.repoName)
  if (matches.length === 0) throw new Error('GitHub repository not found.')
  if (matches.length > 1) {
    throw new Error('Multiple repositories matched repo_name. Provide github_repo_id instead.')
  }
  return matches[0]!
}

async function resolveAgentRecord(input: { agentId?: string; agentHandle?: string }) {
  if (input.agentId) {
    const agent = await findAgentById(input.agentId)
    if (!agent) throw new Error('Agent not found.')
    return agent
  }
  if (input.agentHandle) {
    const agent = await findAgentByHandle(input.agentHandle)
    if (!agent) throw new Error('Agent not found.')
    return agent
  }
  throw new Error('agent_id or agent_handle is required.')
}

async function resolveRoleRecord(input: { roleId?: string; roleSlug?: string }) {
  if (input.roleId) {
    const role = await findRoleById(input.roleId)
    if (!role) throw new Error('Role not found.')
    return role
  }
  if (input.roleSlug) {
    const role = await findRoleBySlug(input.roleSlug)
    if (!role) throw new Error('Role not found.')
    return role
  }
  throw new Error('role_id or role_slug is required.')
}

export const listGitHubReposDefinition: Anthropic.Tool = {
  name: 'list_github_repos',
  description:
    'List synced GitHub repositories and installation context for the GitHub app. This inspects repo access policy state, not repo contents.',
  input_schema: {
    type: 'object' as const,
    properties: {
      plugin_instance_id: {
        type: 'string',
        description: 'Optional GitHub plugin instance ID to filter repos to one app installation.',
      },
    },
  },
}

export const listGitHubRepoAssignmentsDefinition: Anthropic.Tool = {
  name: 'list_github_repo_assignments',
  description:
    'List direct agent-to-repository GitHub capability assignments. This shows internal repo access policy, not plugin assignment.',
  input_schema: {
    type: 'object' as const,
    properties: {
      plugin_instance_id: { type: 'string' },
      agent_id: { type: 'string' },
      agent_handle: { type: 'string' },
      github_repo_id: { type: 'integer' },
      repo_name: { type: 'string' },
    },
  },
}

export const updateAgentGitHubRepoAssignmentDefinition: Anthropic.Tool = {
  name: 'update_agent_github_repo_assignment',
  description:
    'Create, replace, or remove one direct agent-to-repository GitHub capability assignment. Use this to grant repo access itself, not just the plugin.',
  input_schema: {
    type: 'object' as const,
    properties: {
      agent_id: { type: 'string' },
      agent_handle: { type: 'string' },
      github_repo_id: { type: 'integer' },
      repo_name: { type: 'string' },
      plugin_instance_id: { type: 'string' },
      capabilities: {
        type: 'array' as const,
        items: { type: 'string', enum: [...GITHUB_REPO_CAPABILITY_IDS] },
        description:
          'Capability IDs to grant. Pass an empty array to remove the direct assignment for this repo.',
      },
    },
    required: ['capabilities'],
  },
}

export const listRoleGitHubRepoPoliciesDefinition: Anthropic.Tool = {
  name: 'list_role_github_repo_policies',
  description:
    'List reusable role-level GitHub repo policies. These are defaults that can flow to agents via role assignment or team defaults.',
  input_schema: {
    type: 'object' as const,
    properties: {
      role_id: { type: 'string' },
      role_slug: { type: 'string' },
    },
  },
}

export const updateRoleGitHubRepoPoliciesDefinition: Anthropic.Tool = {
  name: 'update_role_github_repo_policies',
  description:
    'Replace the full role-level GitHub repo policy set for a role. This manages reusable defaults, not direct agent/repo assignments.',
  input_schema: {
    type: 'object' as const,
    properties: {
      role_id: { type: 'string' },
      role_slug: { type: 'string' },
      plugin_instance_id: { type: 'string' },
      policies: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            github_repo_id: { type: 'integer' },
            repo_name: { type: 'string' },
            capabilities: {
              type: 'array' as const,
              items: { type: 'string', enum: [...GITHUB_REPO_CAPABILITY_IDS] },
            },
          },
          required: ['capabilities'],
        },
      },
    },
    required: ['policies'],
  },
}

export const githubPolicyDefinitions: Anthropic.Tool[] = [
  listGitHubReposDefinition,
  listGitHubRepoAssignmentsDefinition,
  updateAgentGitHubRepoAssignmentDefinition,
  listRoleGitHubRepoPoliciesDefinition,
  updateRoleGitHubRepoPoliciesDefinition,
]

export const listGitHubReposTool: ToolHandler = async (input, context) => {
  try {
    const actorAgentId = requireAgentId(context)
    await assertGitHubRepoPolicyGrant(actorAgentId, 'github.repo.policy.read')
    const pluginInstanceId = readString(input, 'plugin_instance_id')
    const repos = await listGitHubRepos(pluginInstanceId ? { pluginInstanceId } : undefined)
    return { success: true, output: toJsonOutput({ repos }) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const listGitHubRepoAssignmentsTool: ToolHandler = async (input, context) => {
  try {
    const actorAgentId = requireAgentId(context)
    await assertGitHubRepoPolicyGrant(actorAgentId, 'github.repo.policy.read')
    const pluginInstanceId = readString(input, 'plugin_instance_id')
    const agentId = readString(input, 'agent_id')
    const agentHandle = readString(input, 'agent_handle')
    const repoName = readString(input, 'repo_name')
    const githubRepoId =
      typeof input.github_repo_id === 'number' ? Math.trunc(input.github_repo_id) : undefined

    const resolvedAgent = agentId || agentHandle ? await resolveAgentRecord({ agentId, agentHandle }) : null
    const resolvedRepo =
      githubRepoId !== undefined || repoName
        ? await resolveRepoRecord({ githubRepoId, repoName, pluginInstanceId })
        : null

    const assignments = await listAgentGitHubRepoAssignments({
      ...(pluginInstanceId ? { pluginInstanceId } : {}),
      ...(resolvedAgent ? { agentId: resolvedAgent.id } : {}),
      ...(resolvedRepo ? { githubRepoId: resolvedRepo.githubRepoId } : {}),
    })

    return { success: true, output: toJsonOutput({ assignments }) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const updateAgentGitHubRepoAssignmentTool: ToolHandler = async (input, context) => {
  try {
    const actorAgentId = requireAgentId(context)
    await assertGitHubRepoPolicyGrant(actorAgentId, 'github.repo.policy.write')
    const pluginInstanceId = readString(input, 'plugin_instance_id')
    const agent = await resolveAgentRecord({
      agentId: readString(input, 'agent_id'),
      agentHandle: readString(input, 'agent_handle'),
    })
    const repo = await resolveRepoRecord({
      githubRepoId:
        typeof input.github_repo_id === 'number' ? Math.trunc(input.github_repo_id) : undefined,
      repoName: readString(input, 'repo_name'),
      pluginInstanceId,
    })
    const capabilities = parseCapabilities(input)

    await replaceAgentGitHubRepoCapabilities(agent.id, repo.githubRepoId, capabilities)
    const assignments = await listAgentGitHubRepoAssignments({
      agentId: agent.id,
      githubRepoId: repo.githubRepoId,
    })

    return {
      success: true,
      output: toJsonOutput({
        ok: true,
        directAssignment: assignments[0] ?? null,
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const listRoleGitHubRepoPoliciesTool: ToolHandler = async (input, context) => {
  try {
    const actorAgentId = requireAgentId(context)
    await assertGitHubRepoPolicyGrant(actorAgentId, 'github.repo.policy.read')
    const roleId = readString(input, 'role_id')
    const roleSlug = readString(input, 'role_slug')

    if (roleId || roleSlug) {
      const role = await resolveRoleRecord({ roleId, roleSlug })
      const policies = await listRoleGitHubRepoPolicies(role.id)
      return {
        success: true,
        output: toJsonOutput({
          role: { id: role.id, slug: role.slug, name: role.name },
          policies,
        }),
      }
    }

    const roles = await listRoles()
    const rows = await Promise.all(
      roles.map(async (role) => {
        const policies = await listRoleGitHubRepoPolicies(role.id)
        if (policies.length === 0) return null
        return {
          role: { id: role.id, slug: role.slug, name: role.name },
          policies,
        }
      })
    )

    return {
      success: true,
      output: toJsonOutput({
        roles: rows.filter((row): row is NonNullable<typeof row> => row !== null),
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const updateRoleGitHubRepoPoliciesTool: ToolHandler = async (input, context) => {
  try {
    const actorAgentId = requireAgentId(context)
    await assertGitHubRepoPolicyGrant(actorAgentId, 'github.repo.policy.write')
    const role = await resolveRoleRecord({
      roleId: readString(input, 'role_id'),
      roleSlug: readString(input, 'role_slug'),
    })
    const pluginInstanceId = readString(input, 'plugin_instance_id')
    const rawPolicies = Array.isArray(input.policies) ? input.policies : null
    if (!rawPolicies) {
      throw new Error('policies is required.')
    }

    const policies = await Promise.all(
      rawPolicies.map(async (entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw new Error(`policies[${index}] must be an object.`)
        }
        const row = entry as Record<string, unknown>
        const repo = await resolveRepoRecord({
          githubRepoId:
            typeof row.github_repo_id === 'number' ? Math.trunc(row.github_repo_id) : undefined,
          repoName: typeof row.repo_name === 'string' ? row.repo_name.trim() : undefined,
          pluginInstanceId,
        })
        return {
          githubRepoId: repo.githubRepoId,
          capabilities: parseCapabilities(row, 'capabilities', `policies[${index}].capabilities`),
        }
      })
    )

    await replaceRoleGitHubRepoPolicies(role.id, policies)
    const nextPolicies = await listRoleGitHubRepoPolicies(role.id)

    return {
      success: true,
      output: toJsonOutput({
        ok: true,
        role: { id: role.id, slug: role.slug, name: role.name },
        policies: nextPolicies,
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
