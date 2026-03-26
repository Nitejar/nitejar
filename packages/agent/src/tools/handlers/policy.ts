import type Anthropic from '@anthropic-ai/sdk'
import {
  assertAgentGrant,
  assignRoleToAgent,
  createRole,
  findAgentById,
  findRoleById,
  findRoleBySlug,
  getDb,
  listRoleDefaults,
  listRoleGrants,
  listRoles,
  removeRoleFromAgent,
  replaceRoleDefaults,
  replaceRoleGrants,
  updateRole,
} from '@nitejar/database'
import type { ToolHandler } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required.`)
  }
  return value.trim()
}

function toJsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

function parseGrantsInput(
  input: Record<string, unknown>
): Array<{ action: string; resource_type?: string | null; resource_id?: string | null }> | null {
  const grants = input.grants
  if (grants === undefined || grants === null) return null
  if (!Array.isArray(grants)) throw new Error('grants must be an array.')
  return grants.map((g: unknown) => {
    if (typeof g !== 'object' || g === null) throw new Error('Each grant must be an object.')
    const grant = g as Record<string, unknown>
    if (typeof grant.action !== 'string' || grant.action.trim().length === 0) {
      throw new Error('Each grant must have a non-empty action string.')
    }
    return {
      action: grant.action.trim(),
      resource_type:
        typeof grant.resourceType === 'string' ? grant.resourceType.trim() || null : null,
      resource_id: typeof grant.resourceId === 'string' ? grant.resourceId.trim() || null : null,
    }
  })
}

function parseDefaultsInput(
  input: Record<string, unknown>
): Array<{ key: string; value_json: string }> | null {
  const defaults = input.defaults
  if (defaults === undefined || defaults === null) return null
  if (!Array.isArray(defaults)) throw new Error('defaults must be an array.')
  return defaults.map((d: unknown) => {
    if (typeof d !== 'object' || d === null) throw new Error('Each default must be an object.')
    const def = d as Record<string, unknown>
    if (typeof def.key !== 'string' || def.key.trim().length === 0) {
      throw new Error('Each default must have a non-empty key string.')
    }
    return {
      key: def.key.trim(),
      value_json: JSON.stringify(def.value ?? null),
    }
  })
}

async function assertPolicyGrant(input: {
  actorAgentId?: string
  action: string
  resourceId?: string | null
}) {
  if (!input.actorAgentId) {
    throw new Error('Missing agent identity.')
  }
  await assertAgentGrant({
    agentId: input.actorAgentId,
    action: input.action,
    resourceType: '*',
    resourceId: input.resourceId ?? null,
  })
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const policyToolDefinitions: Anthropic.Tool[] = [
  {
    name: 'list_roles',
    description: 'List all roles in the policy system with grant and default counts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        active_only: {
          type: 'boolean',
          description: 'Only return active roles. Defaults to true.',
        },
      },
    },
  },
  {
    name: 'get_role',
    description: 'Get full role details including grants and defaults.',
    input_schema: {
      type: 'object' as const,
      properties: {
        role_id: { type: 'string' },
      },
      required: ['role_id'],
    },
  },
  {
    name: 'create_role',
    description: 'Create a new policy role with optional grants and defaults.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Human-readable role name.' },
        slug: {
          type: 'string',
          description: 'Unique machine-friendly identifier for the role.',
        },
        charter: {
          type: 'string',
          description: 'Optional charter describing the role purpose.',
        },
        grants: {
          type: 'array',
          description: 'Optional initial grants for the role.',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              resourceType: { type: 'string' },
            },
            required: ['action'],
          },
        },
        defaults: {
          type: 'array',
          description: 'Optional initial defaults for the role.',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: {},
            },
            required: ['key', 'value'],
          },
        },
      },
      required: ['name', 'slug'],
    },
  },
  {
    name: 'update_role',
    description: 'Update a policy role. Grants and defaults are fully replaced if provided.',
    input_schema: {
      type: 'object' as const,
      properties: {
        role_id: { type: 'string' },
        name: { type: 'string' },
        charter: { type: 'string' },
        grants: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              resourceType: { type: 'string' },
            },
            required: ['action'],
          },
        },
        defaults: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: {},
            },
            required: ['key', 'value'],
          },
        },
      },
      required: ['role_id'],
    },
  },
  {
    name: 'delete_role',
    description: 'Delete a policy role. Fails if any agents currently have the role assigned.',
    input_schema: {
      type: 'object' as const,
      properties: {
        role_id: { type: 'string' },
      },
      required: ['role_id'],
    },
  },
  {
    name: 'assign_role',
    description: 'Assign a policy role to an agent.',
    input_schema: {
      type: 'object' as const,
      properties: {
        role_id: { type: 'string' },
        agent_id: { type: 'string' },
      },
      required: ['role_id', 'agent_id'],
    },
  },
  {
    name: 'unassign_role',
    description: 'Remove a policy role from an agent.',
    input_schema: {
      type: 'object' as const,
      properties: {
        role_id: { type: 'string' },
        agent_id: { type: 'string' },
      },
      required: ['role_id', 'agent_id'],
    },
  },
]

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const listRolesTool: ToolHandler = async (input, context) => {
  try {
    await assertPolicyGrant({
      actorAgentId: context.agentId,
      action: 'policy.read',
    })

    const activeOnly = input.active_only !== false
    const roles = await listRoles({ activeOnly })

    const summaries = await Promise.all(
      roles.map(async (role) => {
        const [grants, defaults] = await Promise.all([
          listRoleGrants(role.id),
          listRoleDefaults(role.id),
        ])
        return {
          id: role.id,
          slug: role.slug,
          name: role.name,
          charter: role.charter ?? null,
          active: role.active === 1,
          grantCount: grants.length,
          defaultCount: defaults.length,
        }
      })
    )

    return {
      success: true,
      output: toJsonOutput({ roles: summaries }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const getRoleTool: ToolHandler = async (input, context) => {
  try {
    const roleId = requireString(input, 'role_id')
    await assertPolicyGrant({
      actorAgentId: context.agentId,
      action: 'policy.read',
      resourceId: roleId,
    })

    const role = await findRoleById(roleId)
    if (!role) {
      return { success: false, error: 'Role not found.' }
    }

    const [grants, defaults] = await Promise.all([
      listRoleGrants(role.id),
      listRoleDefaults(role.id),
    ])

    return {
      success: true,
      output: toJsonOutput({
        role: {
          id: role.id,
          slug: role.slug,
          name: role.name,
          charter: role.charter ?? null,
          job_description: role.job_description ?? null,
          escalation_posture: role.escalation_posture ?? null,
          active: role.active === 1,
          grants: grants.map((g) => ({
            id: g.id,
            action: g.action,
            resourceType: g.resource_type,
            resourceId: g.resource_id,
          })),
          defaults: defaults.map((d) => ({
            id: d.id,
            key: d.key,
            value: safeParseJson(d.value_json),
          })),
        },
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const createRoleTool: ToolHandler = async (input, context) => {
  try {
    await assertPolicyGrant({
      actorAgentId: context.agentId,
      action: 'policy.create',
    })

    const name = requireString(input, 'name')
    const slug = requireString(input, 'slug')
    const charter = typeof input.charter === 'string' ? input.charter.trim() || null : null

    const existing = await findRoleBySlug(slug)
    if (existing) {
      return { success: false, error: `A role with slug "${slug}" already exists.` }
    }

    const role = await createRole({
      slug,
      name,
      charter,
      job_description: null,
      escalation_posture: null,
      active: 1,
    })

    const grants = parseGrantsInput(input)
    if (grants && grants.length > 0) {
      await replaceRoleGrants(role.id, grants)
    }

    const defaults = parseDefaultsInput(input)
    if (defaults && defaults.length > 0) {
      await replaceRoleDefaults(role.id, defaults)
    }

    return {
      success: true,
      output: toJsonOutput({
        created: {
          id: role.id,
          slug: role.slug,
          name: role.name,
          charter: role.charter ?? null,
          active: role.active === 1,
        },
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const updateRoleTool: ToolHandler = async (input, context) => {
  try {
    const roleId = requireString(input, 'role_id')
    await assertPolicyGrant({
      actorAgentId: context.agentId,
      action: 'policy.write',
      resourceId: roleId,
    })

    const existing = await findRoleById(roleId)
    if (!existing) {
      return { success: false, error: 'Role not found.' }
    }

    const updates: Record<string, unknown> = {}
    if (typeof input.name === 'string' && input.name.trim().length > 0) {
      updates.name = input.name.trim()
    }
    if (typeof input.charter === 'string') {
      updates.charter = input.charter.trim() || null
    }

    if (Object.keys(updates).length > 0) {
      await updateRole(roleId, updates)
    }

    const grants = parseGrantsInput(input)
    if (grants !== null) {
      await replaceRoleGrants(roleId, grants)
    }

    const defaults = parseDefaultsInput(input)
    if (defaults !== null) {
      await replaceRoleDefaults(roleId, defaults)
    }

    const updated = await findRoleById(roleId)
    return {
      success: true,
      output: toJsonOutput({
        updated: {
          id: updated!.id,
          slug: updated!.slug,
          name: updated!.name,
          charter: updated!.charter ?? null,
          active: updated!.active === 1,
        },
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const deleteRoleTool: ToolHandler = async (input, context) => {
  try {
    const roleId = requireString(input, 'role_id')
    await assertPolicyGrant({
      actorAgentId: context.agentId,
      action: 'policy.delete',
      resourceId: roleId,
    })

    const role = await findRoleById(roleId)
    if (!role) {
      return { success: false, error: 'Role not found.' }
    }

    // Check if any agents have this role assigned
    const db = getDb()
    const assignments = await db
      .selectFrom('agent_role_assignments')
      .select(db.fn.countAll().as('count'))
      .where('role_id', '=', roleId)
      .executeTakeFirstOrThrow()
    const assignedCount = Number(assignments.count)

    if (assignedCount > 0) {
      return {
        success: false,
        error: `Cannot delete role "${role.name}": ${assignedCount} agent(s) currently have this role assigned. Remove assignments first.`,
      }
    }

    // Delete grants, defaults, then the role itself
    await db.deleteFrom('role_grants').where('role_id', '=', roleId).execute()
    await db.deleteFrom('role_defaults').where('role_id', '=', roleId).execute()
    await db.deleteFrom('roles').where('id', '=', roleId).execute()

    return {
      success: true,
      output: toJsonOutput({ deleted: true, roleId, roleName: role.name }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const assignRoleTool: ToolHandler = async (input, context) => {
  try {
    const roleId = requireString(input, 'role_id')
    const agentId = requireString(input, 'agent_id')
    await assertPolicyGrant({
      actorAgentId: context.agentId,
      action: 'policy.write',
    })

    const role = await findRoleById(roleId)
    if (!role) {
      return { success: false, error: 'Role not found.' }
    }

    const agent = await findAgentById(agentId)
    if (!agent) {
      return { success: false, error: 'Agent not found.' }
    }

    await assignRoleToAgent(agentId, roleId)

    return {
      success: true,
      output: toJsonOutput({
        assigned: true,
        agentId,
        agentHandle: agent.handle,
        roleId,
        roleName: role.name,
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const unassignRoleTool: ToolHandler = async (input, context) => {
  try {
    const roleId = requireString(input, 'role_id')
    const agentId = requireString(input, 'agent_id')
    await assertPolicyGrant({
      actorAgentId: context.agentId,
      action: 'policy.write',
    })

    const removed = await removeRoleFromAgent(agentId, roleId)
    if (!removed) {
      return { success: false, error: 'Agent did not have this role assigned.' }
    }

    return {
      success: true,
      output: toJsonOutput({ unassigned: true, agentId, roleId }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
