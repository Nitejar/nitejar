import type Anthropic from '@anthropic-ai/sdk'
import {
  createAgent,
  createAgentSandbox,
  deleteAgent,
  findAgentByHandle,
  findAgentById,
  listAgents,
  updateAgent,
} from '@nitejar/database'
import {
  getDefaultModel,
  mergeAgentConfig,
  parseAgentConfig,
  serializeAgentConfig,
} from '../../config'
import { DEFAULT_NETWORK_POLICY } from '../../network-policy'
import type { AgentConfig } from '../../types'
import type { ToolHandler } from '../types'

const AGENT_STATUS_VALUES = new Set(['idle', 'busy', 'offline'])
const HANDLE_PATTERN = /^[a-zA-Z0-9_-]+$/

function cloneDefaultNetworkPolicy() {
  return {
    ...DEFAULT_NETWORK_POLICY,
    rules: DEFAULT_NETWORK_POLICY.rules.map((rule) => ({ ...rule })),
  }
}

async function assertDangerousPlatformControl(agentId?: string): Promise<void> {
  if (!agentId) {
    throw new Error('Missing agent identity.')
  }

  const actor = await findAgentById(agentId)
  if (!actor) {
    throw new Error('Agent not found.')
  }

  const config = parseAgentConfig(actor.config)
  if (config.dangerouslyUnrestricted !== true) {
    throw new Error(
      'Dangerous platform control is disabled for this agent. Enable dangerously unrestricted mode first.'
    )
  }
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required.`)
  }
  return value.trim()
}

function parseStatus(input: Record<string, unknown>, key: string, fallback: string): string {
  const value = input[key]
  const raw = typeof value === 'string' ? value.trim() : fallback
  if (!AGENT_STATUS_VALUES.has(raw)) {
    throw new Error(`${key} must be one of: idle, busy, offline.`)
  }
  return raw
}

function parseConfigUpdates(input: Record<string, unknown>): Partial<AgentConfig> {
  const updates = input.updates ?? input.config_updates
  if (!updates) return {}
  if (typeof updates !== 'object' || Array.isArray(updates)) {
    throw new Error('updates must be an object.')
  }
  return updates as Partial<AgentConfig>
}

function toJsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

function agentSummaryRow(agent: {
  id: string
  handle: string
  name: string
  status: string
  config: string | null
}) {
  const config = parseAgentConfig(agent.config)
  return {
    id: agent.id,
    handle: agent.handle,
    name: agent.name,
    status: agent.status,
    title: config.title ?? null,
    dangerouslyUnrestricted: config.dangerouslyUnrestricted === true,
  }
}

export const platformControlDefinitions: Anthropic.Tool[] = [
  {
    name: 'list_agents',
    description: 'List every agent in this fleet, including status and dangerous-mode posture.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_agent_config',
    description: 'Get one agent and its parsed configuration.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_agent_soul',
    description: 'Get one agent soul document.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'create_agent',
    description:
      'Create a new agent with optional config overrides. This creates a home sandbox automatically.',
    input_schema: {
      type: 'object' as const,
      properties: {
        handle: { type: 'string' },
        name: { type: 'string' },
        status: { type: 'string', enum: ['idle', 'busy', 'offline'] },
        config_updates: { type: 'object' },
      },
      required: ['handle', 'name'],
    },
  },
  {
    name: 'set_agent_status',
    description: 'Set an agent status to idle, busy, or offline.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string' },
        status: { type: 'string', enum: ['idle', 'busy', 'offline'] },
      },
      required: ['agent_id', 'status'],
    },
  },
  {
    name: 'delete_agent',
    description:
      'Delete an agent. Set confirm=true to proceed. This cannot be undone from this tool.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['agent_id', 'confirm'],
    },
  },
  {
    name: 'update_agent_config',
    description: 'Merge partial config updates into an agent configuration.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string' },
        updates: { type: 'object' },
      },
      required: ['agent_id', 'updates'],
    },
  },
  {
    name: 'update_agent_soul',
    description: 'Replace an agent soul document.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string' },
        soul: { type: 'string' },
      },
      required: ['agent_id', 'soul'],
    },
  },
]

export const listAgentsTool: ToolHandler = async (_input, context) => {
  try {
    await assertDangerousPlatformControl(context.agentId)
    const agents = await listAgents()
    return {
      success: true,
      output: toJsonOutput({ agents: agents.map(agentSummaryRow) }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const getAgentConfigTool: ToolHandler = async (input, context) => {
  try {
    await assertDangerousPlatformControl(context.agentId)
    const agentId = requireString(input, 'agent_id')
    const agent = await findAgentById(agentId)
    if (!agent) {
      return { success: false, error: 'Agent not found.' }
    }

    return {
      success: true,
      output: toJsonOutput({
        agent: {
          ...agentSummaryRow(agent),
          config: parseAgentConfig(agent.config),
        },
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const getAgentSoulTool: ToolHandler = async (input, context) => {
  try {
    await assertDangerousPlatformControl(context.agentId)
    const agentId = requireString(input, 'agent_id')
    const agent = await findAgentById(agentId)
    if (!agent) {
      return { success: false, error: 'Agent not found.' }
    }

    const config = parseAgentConfig(agent.config)
    return {
      success: true,
      output: toJsonOutput({
        agentId: agent.id,
        soul: config.soul ?? '',
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const createAgentTool: ToolHandler = async (input, context) => {
  try {
    await assertDangerousPlatformControl(context.agentId)

    const handle = requireString(input, 'handle')
    if (!HANDLE_PATTERN.test(handle)) {
      return {
        success: false,
        error: 'handle can only contain letters, numbers, hyphens, and underscores.',
      }
    }

    const name = requireString(input, 'name')
    const status = parseStatus(input, 'status', 'idle')

    const existing = await findAgentByHandle(handle)
    if (existing) {
      return { success: false, error: `Agent handle "${handle}" is already in use.` }
    }

    const baseConfig: AgentConfig = {
      model: getDefaultModel(),
      memorySettings: {
        passiveUpdatesEnabled: true,
      },
      networkPolicy: cloneDefaultNetworkPolicy(),
    }
    const configUpdates = parseConfigUpdates(input)
    const config = mergeAgentConfig(baseConfig, configUpdates)

    const created = await createAgent({
      handle,
      name,
      sprite_id: null,
      status,
      config: serializeAgentConfig(config),
    })

    await createAgentSandbox({
      agent_id: created.id,
      name: 'home',
      description: 'Persistent home sandbox',
      sprite_name: `nitejar-${created.handle}`,
      kind: 'home',
      created_by: 'agent',
    })

    return {
      success: true,
      output: toJsonOutput({
        created: {
          ...agentSummaryRow(created),
          config,
        },
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const setAgentStatusTool: ToolHandler = async (input, context) => {
  try {
    await assertDangerousPlatformControl(context.agentId)
    const agentId = requireString(input, 'agent_id')
    const status = parseStatus(input, 'status', 'idle')

    const updated = await updateAgent(agentId, { status })
    if (!updated) {
      return { success: false, error: 'Agent not found.' }
    }

    return {
      success: true,
      output: toJsonOutput({
        agent: agentSummaryRow(updated),
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const deleteAgentTool: ToolHandler = async (input, context) => {
  try {
    await assertDangerousPlatformControl(context.agentId)
    const agentId = requireString(input, 'agent_id')
    const confirm = input.confirm === true
    if (!confirm) {
      return { success: false, error: 'Set confirm=true to delete an agent.' }
    }
    if (context.agentId === agentId) {
      return { success: false, error: 'Cannot delete the currently running agent.' }
    }

    const deleted = await deleteAgent(agentId)
    if (!deleted) {
      return { success: false, error: 'Agent not found or could not be deleted.' }
    }

    return {
      success: true,
      output: toJsonOutput({ deleted: true, agentId }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const updateAgentConfigTool: ToolHandler = async (input, context) => {
  try {
    await assertDangerousPlatformControl(context.agentId)
    const agentId = requireString(input, 'agent_id')
    const updates = parseConfigUpdates(input)
    const agent = await findAgentById(agentId)
    if (!agent) {
      return { success: false, error: 'Agent not found.' }
    }

    const merged = mergeAgentConfig(parseAgentConfig(agent.config), updates)
    const updated = await updateAgent(agentId, { config: serializeAgentConfig(merged) })
    if (!updated) {
      return { success: false, error: 'Failed to update agent config.' }
    }

    return {
      success: true,
      output: toJsonOutput({
        agentId,
        changedFields: Object.keys(updates).sort(),
        config: merged,
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const updateAgentSoulTool: ToolHandler = async (input, context) => {
  try {
    await assertDangerousPlatformControl(context.agentId)
    const agentId = requireString(input, 'agent_id')
    const soul = requireString(input, 'soul')
    const agent = await findAgentById(agentId)
    if (!agent) {
      return { success: false, error: 'Agent not found.' }
    }

    const merged = mergeAgentConfig(parseAgentConfig(agent.config), { soul })
    const updated = await updateAgent(agentId, { config: serializeAgentConfig(merged) })
    if (!updated) {
      return { success: false, error: 'Failed to update agent soul.' }
    }

    return {
      success: true,
      output: toJsonOutput({
        agentId,
        soul: merged.soul ?? '',
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
