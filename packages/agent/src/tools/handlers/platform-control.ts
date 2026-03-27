import type Anthropic from '@anthropic-ai/sdk'
import {
  assertAgentGrant,
  createAgent,
  createAgentSandbox,
  deleteAgent,
  findAgentByHandle,
  findAgentById,
  findPluginInstanceById,
  getAgentPluginInstanceAssignment,
  getPluginInstancesForAgent,
  listAgentIdsForPluginInstance,
  listAgents,
  listPluginInstancesWithAgents,
  setAgentPluginInstanceAssignment,
  updateAgent,
} from '@nitejar/database'
import { pluginHandlerRegistry } from '@nitejar/plugin-handlers/registry'
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

async function assertFleetGrant(input: {
  actorAgentId?: string
  action: string
  targetAgentId?: string
}) {
  if (!input.actorAgentId) {
    throw new Error('Missing agent identity.')
  }

  await assertAgentGrant({
    agentId: input.actorAgentId,
    action: input.action,
    resourceType: 'agent',
    resourceId: input.targetAgentId ?? null,
  })
}

async function assertPluginInstanceGrant(input: {
  actorAgentId?: string
  action: string
  pluginInstanceId?: string | null
}) {
  if (!input.actorAgentId) {
    throw new Error('Missing agent identity.')
  }

  await assertAgentGrant({
    agentId: input.actorAgentId,
    action: input.action,
    resourceType: 'plugin_instance',
    resourceId: input.pluginInstanceId ?? null,
  })
}

async function canReadPluginInstances(input: {
  actorAgentId?: string
  pluginInstanceId?: string | null
}): Promise<boolean> {
  try {
    await assertPluginInstanceGrant({
      actorAgentId: input.actorAgentId,
      action: 'plugins.instances.read',
      pluginInstanceId: input.pluginInstanceId ?? null,
    })
    return true
  } catch {
    return false
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

function normalizeAssignmentPolicy(
  value:
    | {
        mode?: 'allow_all' | 'allow_list'
        allowedActions?: string[]
      }
    | null
    | undefined
): { mode: 'allow_all' | 'allow_list'; allowedActions: string[] } | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null

  const mode = value.mode === 'allow_list' ? 'allow_list' : 'allow_all'
  const allowedActions = Array.isArray(value.allowedActions)
    ? [...new Set(value.allowedActions.filter((entry) => typeof entry === 'string'))]
    : []

  return {
    mode,
    allowedActions,
  }
}

function toJsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

function isEncryptedValue(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('enc:')
}

function redactConfigValue(
  value: unknown,
  sensitiveKeys: Set<string>,
  currentKey?: string
): unknown {
  if (currentKey && sensitiveKeys.has(currentKey)) {
    return '••••••••'
  }

  if (isEncryptedValue(value)) {
    return '••••••••'
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactConfigValue(entry, sensitiveKeys))
  }

  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>
    const output: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(input)) {
      output[key] = redactConfigValue(nested, sensitiveKeys, key)
    }
    return output
  }

  return value
}

function parseAndRedactPluginConfig(type: string, rawConfig: string | null): unknown {
  if (!rawConfig) return null
  try {
    const parsed = JSON.parse(rawConfig) as unknown
    const handler = pluginHandlerRegistry.get(type)
    return redactConfigValue(parsed, new Set(handler?.sensitiveFields ?? []))
  } catch {
    return null
  }
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
  }
}

export const platformControlDefinitions: Anthropic.Tool[] = [
  {
    name: 'list_agents',
    description: 'List every agent in this fleet, including status and identity metadata.',
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
    name: 'list_plugin_instances',
    description:
      'List plugin instances in the fleet along with which agents are assigned to each one.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_plugin_instance',
    description:
      'Get one plugin instance, including redacted config and the IDs of agents assigned to it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        plugin_instance_id: { type: 'string' },
      },
      required: ['plugin_instance_id'],
    },
  },
  {
    name: 'set_plugin_instance_agent_assignment',
    description:
      'Assign or unassign an agent for a plugin instance, with optional action allow-list policy.',
    input_schema: {
      type: 'object' as const,
      properties: {
        plugin_instance_id: { type: 'string' },
        agent_id: { type: 'string' },
        enabled: { type: 'boolean' },
        policy: {
          type: 'object' as const,
          properties: {
            mode: { type: 'string', enum: ['allow_all', 'allow_list'] },
            allowedActions: {
              type: 'array' as const,
              items: { type: 'string' },
            },
          },
        },
      },
      required: ['plugin_instance_id', 'agent_id', 'enabled'],
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
    await assertFleetGrant({
      actorAgentId: context.agentId,
      action: 'fleet.agent.read',
    })
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
    const agentId = requireString(input, 'agent_id')
    await assertFleetGrant({
      actorAgentId: context.agentId,
      action: 'fleet.agent.read',
      targetAgentId: agentId,
    })
    const agent = await findAgentById(agentId)
    if (!agent) {
      return { success: false, error: 'Agent not found.' }
    }

    const includePluginInstances = await canReadPluginInstances({
      actorAgentId: context.agentId,
    })

    return {
      success: true,
      output: toJsonOutput({
        agent: {
          ...agentSummaryRow(agent),
          config: parseAgentConfig(agent.config),
          ...(includePluginInstances
            ? {
                pluginInstances: await getPluginInstancesForAgent(agentId),
              }
            : {}),
        },
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const listPluginInstancesTool: ToolHandler = async (_input, context) => {
  try {
    await assertPluginInstanceGrant({
      actorAgentId: context.agentId,
      action: 'plugins.instances.read',
    })
    const pluginInstances = await listPluginInstancesWithAgents()
    return {
      success: true,
      output: toJsonOutput({
        pluginInstances: pluginInstances.map((pluginInstance) => ({
          id: pluginInstance.id,
          name: pluginInstance.name,
          type: pluginInstance.type,
          enabled: pluginInstance.enabled === 1,
          scope: pluginInstance.scope,
          agents: pluginInstance.agents,
        })),
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const getPluginInstanceTool: ToolHandler = async (input, context) => {
  try {
    const pluginInstanceId = requireString(input, 'plugin_instance_id')
    await assertPluginInstanceGrant({
      actorAgentId: context.agentId,
      action: 'plugins.instances.read',
      pluginInstanceId,
    })
    const pluginInstance = await findPluginInstanceById(pluginInstanceId)
    if (!pluginInstance) {
      return { success: false, error: 'Plugin instance not found.' }
    }

    const assignedAgentIds = await listAgentIdsForPluginInstance(pluginInstanceId)
    return {
      success: true,
      output: toJsonOutput({
        pluginInstance: {
          id: pluginInstance.id,
          name: pluginInstance.name,
          type: pluginInstance.type,
          enabled: pluginInstance.enabled === 1,
          scope: pluginInstance.scope,
          config: parseAndRedactPluginConfig(pluginInstance.type, pluginInstance.config),
        },
        assignedAgentIds,
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const setPluginInstanceAgentAssignmentTool: ToolHandler = async (input, context) => {
  try {
    const pluginInstanceId = requireString(input, 'plugin_instance_id')
    const agentId = requireString(input, 'agent_id')
    const enabled = Boolean(input.enabled)

    await assertPluginInstanceGrant({
      actorAgentId: context.agentId,
      action: 'plugins.instances.write',
      pluginInstanceId,
    })

    const pluginInstance = await findPluginInstanceById(pluginInstanceId)
    if (!pluginInstance) {
      return { success: false, error: 'Plugin instance not found.' }
    }

    const agent = await findAgentById(agentId)
    if (!agent) {
      return { success: false, error: 'Agent not found.' }
    }

    const normalizedPolicy =
      input.policy && typeof input.policy === 'object' && !Array.isArray(input.policy)
        ? normalizeAssignmentPolicy(
            input.policy as {
              mode?: 'allow_all' | 'allow_list'
              allowedActions?: string[]
            }
          )
        : undefined

    await setAgentPluginInstanceAssignment({
      pluginInstanceId,
      agentId,
      enabled,
      ...(normalizedPolicy !== undefined
        ? { policyJson: normalizedPolicy === null ? null : JSON.stringify(normalizedPolicy) }
        : {}),
    })

    const assignment = await getAgentPluginInstanceAssignment({
      pluginInstanceId,
      agentId,
    })

    let policy: { mode: 'allow_all' | 'allow_list'; allowedActions: string[] } | null = null
    if (assignment?.policy_json) {
      try {
        const parsed = JSON.parse(assignment.policy_json) as {
          mode?: 'allow_all' | 'allow_list'
          allowedActions?: string[]
        }
        policy = normalizeAssignmentPolicy(parsed) ?? null
      } catch {
        policy = null
      }
    }

    return {
      success: true,
      output: toJsonOutput({
        ok: true,
        pluginInstanceId,
        agentId,
        enabled,
        policy,
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const getAgentSoulTool: ToolHandler = async (input, context) => {
  try {
    const agentId = requireString(input, 'agent_id')
    await assertFleetGrant({
      actorAgentId: context.agentId,
      action: 'fleet.agent.read',
      targetAgentId: agentId,
    })
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
    await assertFleetGrant({
      actorAgentId: context.agentId,
      action: 'fleet.agent.create',
    })

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
    const agentId = requireString(input, 'agent_id')
    await assertFleetGrant({
      actorAgentId: context.agentId,
      action: 'fleet.agent.control',
      targetAgentId: agentId,
    })
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
    const agentId = requireString(input, 'agent_id')
    await assertFleetGrant({
      actorAgentId: context.agentId,
      action: 'fleet.agent.delete',
      targetAgentId: agentId,
    })
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
    const agentId = requireString(input, 'agent_id')
    await assertFleetGrant({
      actorAgentId: context.agentId,
      action: 'fleet.agent.write',
      targetAgentId: agentId,
    })
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
    const agentId = requireString(input, 'agent_id')
    await assertFleetGrant({
      actorAgentId: context.agentId,
      action: 'fleet.agent.write',
      targetAgentId: agentId,
    })
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
