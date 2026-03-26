import type Anthropic from '@anthropic-ai/sdk'
import {
  assertAgentGrant,
  createTeam,
  updateTeam,
  findTeamById,
  deleteTeam,
  addAgentToTeam,
  removeAgentFromTeam,
  getDb,
} from '@nitejar/database'
import type { ToolHandler } from '../types'

function requireAgentId(context: { agentId?: string }): string {
  const id = context.agentId
  if (!id) throw new Error('Missing agent identity.')
  return id
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required.`)
  }
  return value.trim()
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  if (value == null) return undefined
  if (typeof value !== 'string') throw new Error(`${key} must be a string.`)
  return value.trim() || undefined
}

function optionalStringArray(input: Record<string, unknown>, key: string): string[] | undefined {
  const value = input[key]
  if (value == null) return undefined
  if (!Array.isArray(value)) throw new Error(`${key} must be an array.`)
  for (const item of value) {
    if (typeof item !== 'string') throw new Error(`Each item in ${key} must be a string.`)
  }
  return value as string[]
}

function toJsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const teamDefinitions: Anthropic.Tool[] = [
  {
    name: 'list_teams',
    description: 'List teams in the company, optionally filtered to children of a given team.',
    input_schema: {
      type: 'object' as const,
      properties: {
        parent_team_id: {
          type: 'string',
          description: 'If provided, only return direct children of this team.',
        },
      },
    },
  },
  {
    name: 'get_team',
    description: 'Get a team by ID, including its current members.',
    input_schema: {
      type: 'object' as const,
      properties: {
        team_id: { type: 'string' },
      },
      required: ['team_id'],
    },
  },
  {
    name: 'create_team',
    description: 'Create a new team in the company.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
        charter: { type: 'string', description: 'Team mission or charter statement.' },
        parent_team_id: { type: 'string', description: 'Parent team ID for nesting.' },
        slug: { type: 'string', description: 'URL-friendly slug. Auto-generated if omitted.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_team',
    description: 'Update a team: rename, change charter, and/or add/remove agent members.',
    input_schema: {
      type: 'object' as const,
      properties: {
        team_id: { type: 'string' },
        name: { type: 'string' },
        charter: { type: 'string' },
        add_agent_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Agent IDs to add as members.',
        },
        remove_agent_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Agent IDs to remove from the team.',
        },
      },
      required: ['team_id'],
    },
  },
  {
    name: 'delete_team',
    description:
      'Delete a team. Fails if the team has child teams — remove or re-parent them first.',
    input_schema: {
      type: 'object' as const,
      properties: {
        team_id: { type: 'string' },
      },
      required: ['team_id'],
    },
  },
]

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export const listTeamsTool: ToolHandler = async (input, context) => {
  try {
    const agentId = requireAgentId(context)
    await assertAgentGrant({
      agentId,
      action: 'company.team.read',
      resourceType: 'team',
    })

    const parentTeamId = optionalString(input, 'parent_team_id')

    let query = getDb().selectFrom('teams').selectAll()
    if (parentTeamId !== undefined) {
      query = query.where('parent_team_id', '=', parentTeamId)
    }
    const teams = await query.orderBy('sort_order', 'asc').orderBy('name', 'asc').execute()

    return {
      success: true,
      output: toJsonOutput({
        teams: teams.map((t) => ({
          id: t.id,
          name: t.name,
          charter: t.charter,
          slug: t.slug,
          parent_team_id: t.parent_team_id,
          lead_kind: t.lead_kind,
          lead_ref: t.lead_ref,
        })),
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const getTeamTool: ToolHandler = async (input, context) => {
  try {
    const agentId = requireAgentId(context)
    const teamId = requireString(input, 'team_id')
    await assertAgentGrant({
      agentId,
      action: 'company.team.read',
      resourceType: 'team',
      resourceId: teamId,
    })

    const team = await findTeamById(teamId)
    if (!team) {
      return { success: false, error: 'Team not found.' }
    }

    const members = await getDb()
      .selectFrom('agent_teams')
      .innerJoin('agents', 'agents.id', 'agent_teams.agent_id')
      .select(['agents.id', 'agents.handle', 'agents.name', 'agents.status'])
      .where('agent_teams.team_id', '=', teamId)
      .execute()

    return {
      success: true,
      output: toJsonOutput({
        team: {
          id: team.id,
          name: team.name,
          charter: team.charter,
          slug: team.slug,
          parent_team_id: team.parent_team_id,
          lead_kind: team.lead_kind,
          lead_ref: team.lead_ref,
        },
        members,
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const createTeamTool: ToolHandler = async (input, context) => {
  try {
    const agentId = requireAgentId(context)
    await assertAgentGrant({
      agentId,
      action: 'company.team.create',
      resourceType: 'team',
    })

    const name = requireString(input, 'name')
    const charter = optionalString(input, 'charter') ?? null
    const parentTeamId = optionalString(input, 'parent_team_id') ?? null
    const slug = optionalString(input, 'slug') ?? null

    if (parentTeamId) {
      const parent = await findTeamById(parentTeamId)
      if (!parent) {
        return { success: false, error: 'Parent team not found.' }
      }
    }

    const team = await createTeam({
      name,
      charter,
      parent_team_id: parentTeamId,
      slug,
      lead_kind: null,
      lead_ref: null,
    })

    return {
      success: true,
      output: toJsonOutput({
        created: {
          id: team.id,
          name: team.name,
          charter: team.charter,
          slug: team.slug,
          parent_team_id: team.parent_team_id,
        },
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const updateTeamTool: ToolHandler = async (input, context) => {
  try {
    const agentId = requireAgentId(context)
    const teamId = requireString(input, 'team_id')
    await assertAgentGrant({
      agentId,
      action: 'company.team.write',
      resourceType: 'team',
      resourceId: teamId,
    })

    const existing = await findTeamById(teamId)
    if (!existing) {
      return { success: false, error: 'Team not found.' }
    }

    // Build partial update
    const updates: Record<string, unknown> = {}
    const name = optionalString(input, 'name')
    const charter = optionalString(input, 'charter')
    if (name !== undefined) updates.name = name
    if (charter !== undefined) updates.charter = charter

    if (Object.keys(updates).length > 0) {
      await updateTeam(teamId, updates)
    }

    // Add members
    const addAgentIds = optionalStringArray(input, 'add_agent_ids')
    if (addAgentIds && addAgentIds.length > 0) {
      for (const id of addAgentIds) {
        try {
          await addAgentToTeam({ agent_id: id, team_id: teamId })
        } catch {
          // Ignore duplicates — agent may already be a member
        }
      }
    }

    // Remove members
    const removeAgentIds = optionalStringArray(input, 'remove_agent_ids')
    if (removeAgentIds && removeAgentIds.length > 0) {
      for (const id of removeAgentIds) {
        await removeAgentFromTeam(id, teamId)
      }
    }

    // Fetch updated team
    const updated = await findTeamById(teamId)

    return {
      success: true,
      output: toJsonOutput({
        team: {
          id: updated!.id,
          name: updated!.name,
          charter: updated!.charter,
          slug: updated!.slug,
          parent_team_id: updated!.parent_team_id,
          lead_kind: updated!.lead_kind,
          lead_ref: updated!.lead_ref,
        },
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const deleteTeamTool: ToolHandler = async (input, context) => {
  try {
    const agentId = requireAgentId(context)
    const teamId = requireString(input, 'team_id')
    await assertAgentGrant({
      agentId,
      action: 'company.team.delete',
      resourceType: 'team',
      resourceId: teamId,
    })

    const existing = await findTeamById(teamId)
    if (!existing) {
      return { success: false, error: 'Team not found.' }
    }

    // Check for child teams
    const children = await getDb()
      .selectFrom('teams')
      .select('id')
      .where('parent_team_id', '=', teamId)
      .executeTakeFirst()

    if (children) {
      return {
        success: false,
        error: 'Cannot delete a team that has child teams. Remove or re-parent them first.',
      }
    }

    const deleted = await deleteTeam(teamId)
    if (!deleted) {
      return { success: false, error: 'Failed to delete team.' }
    }

    return {
      success: true,
      output: toJsonOutput({ deleted: true, teamId }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
