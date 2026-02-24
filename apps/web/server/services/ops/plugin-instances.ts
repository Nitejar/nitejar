import {
  findAgentById,
  findPluginInstanceById,
  getAgentPluginInstanceAssignment,
  listAgentAssignmentsForPluginInstances,
  listAgentIdsForPluginInstance,
  searchPluginInstances,
  setAgentPluginInstanceAssignment,
  updatePluginInstance,
} from '@nitejar/database'
import { pluginHandlerRegistry } from '@nitejar/plugin-handlers'
import type {
  GetPluginInstanceInput,
  ListPluginInstancesInput,
  SetPluginInstanceAgentAssignmentInput,
  SetPluginInstanceEnabledInput,
} from '@/server/services/ops/schemas'
import { decodeCursor, encodeCursor } from './cursor'

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

function parseAndRedactConfig(rawConfig: string | null, sensitiveFields: string[]): unknown {
  if (!rawConfig) return null
  try {
    const parsed = JSON.parse(rawConfig) as unknown
    return redactConfigValue(parsed, new Set(sensitiveFields))
  } catch {
    return null
  }
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

export async function listPluginInstancesOp(input: ListPluginInstancesInput) {
  const cursor = decodeCursor(input.cursor)
  if (input.cursor && !cursor) {
    throw new Error('Invalid cursor')
  }

  const result = await searchPluginInstances({
    q: input.q,
    types: input.types,
    enabled: input.enabled,
    agentId: input.agentId,
    limit: input.limit,
    cursor,
  })

  const assignments = await listAgentAssignmentsForPluginInstances(
    result.pluginInstances.map((pluginInstance) => pluginInstance.id)
  )
  const assignmentsByPluginInstance = new Map<string, Array<{ id: string; name: string }>>()
  for (const row of assignments) {
    const existing = assignmentsByPluginInstance.get(row.pluginInstanceId) ?? []
    existing.push({ id: row.agentId, name: row.agentName })
    assignmentsByPluginInstance.set(row.pluginInstanceId, existing)
  }

  return {
    pluginInstances: result.pluginInstances.map((pluginInstance) => ({
      id: pluginInstance.id,
      name: pluginInstance.name,
      type: pluginInstance.type,
      enabled: pluginInstance.enabled === 1,
      scope: pluginInstance.scope,
      createdAt: pluginInstance.created_at,
      updatedAt: pluginInstance.updated_at,
      agents: assignmentsByPluginInstance.get(pluginInstance.id) ?? [],
    })),
    nextCursor: encodeCursor(result.nextCursor),
  }
}

export async function getPluginInstanceOp(input: GetPluginInstanceInput) {
  const pluginInstance = await findPluginInstanceById(input.pluginInstanceId)
  if (!pluginInstance) throw new Error('Plugin instance not found')

  const agentIds = await listAgentIdsForPluginInstance(pluginInstance.id)
  const handler = pluginHandlerRegistry.get(pluginInstance.type)
  const safeConfig = parseAndRedactConfig(pluginInstance.config, handler?.sensitiveFields ?? [])

  const baseUrl =
    process.env.APP_URL ||
    process.env.APP_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000'

  return {
    pluginInstance: {
      id: pluginInstance.id,
      name: pluginInstance.name,
      type: pluginInstance.type,
      enabled: pluginInstance.enabled === 1,
      scope: pluginInstance.scope,
      createdAt: pluginInstance.created_at,
      updatedAt: pluginInstance.updated_at,
      config: safeConfig,
      webhookUrl: `${baseUrl}/api/webhooks/plugins/${pluginInstance.type}/${pluginInstance.id}`,
    },
    assignedAgentIds: agentIds,
  }
}

export async function setPluginInstanceEnabledOp(input: SetPluginInstanceEnabledInput) {
  const pluginInstance = await findPluginInstanceById(input.pluginInstanceId)
  if (!pluginInstance) throw new Error('Plugin instance not found')

  const updated = await updatePluginInstance(input.pluginInstanceId, {
    enabled: input.enabled ? 1 : 0,
  })
  if (!updated) throw new Error('Failed to update plugin instance')

  return {
    pluginInstanceId: updated.id,
    enabled: updated.enabled === 1,
    updatedAt: updated.updated_at,
  }
}

export async function setPluginInstanceAgentAssignmentOp(
  input: SetPluginInstanceAgentAssignmentInput
) {
  const pluginInstance = await findPluginInstanceById(input.pluginInstanceId)
  if (!pluginInstance) throw new Error('Plugin instance not found')

  const agent = await findAgentById(input.agentId)
  if (!agent) throw new Error('Agent not found')

  const normalizedPolicy = normalizeAssignmentPolicy(input.policy)
  await setAgentPluginInstanceAssignment({
    pluginInstanceId: input.pluginInstanceId,
    agentId: input.agentId,
    enabled: input.enabled,
    ...(normalizedPolicy !== undefined
      ? { policyJson: normalizedPolicy === null ? null : JSON.stringify(normalizedPolicy) }
      : {}),
  })

  const assignment = await getAgentPluginInstanceAssignment({
    pluginInstanceId: input.pluginInstanceId,
    agentId: input.agentId,
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
    ok: true,
    pluginInstanceId: input.pluginInstanceId,
    agentId: input.agentId,
    enabled: input.enabled,
    policy,
  }
}
