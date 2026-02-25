import { sql } from 'kysely'
import { getDb } from '../db'
import type {
  Agent,
  NewPluginInstance,
  PluginInstance,
  PluginInstanceRecord,
  PluginInstanceUpdate,
} from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

function pluginTypeCandidates(type: string): string[] {
  const trimmed = type.trim()
  if (!trimmed) return []
  return [trimmed, `builtin.${trimmed}`, `legacy.${trimmed}`]
}

function inferTypeFromPluginId(pluginId: string): string {
  if (pluginId.startsWith('builtin.')) return pluginId.slice('builtin.'.length)
  if (pluginId.startsWith('legacy.')) return pluginId.slice('legacy.'.length)
  const idx = pluginId.lastIndexOf('.')
  return idx >= 0 ? pluginId.slice(idx + 1) : pluginId
}

function toPluginInstanceRecord(row: PluginInstance): PluginInstanceRecord {
  return {
    ...row,
    type: inferTypeFromPluginId(row.plugin_id),
    config: row.config_json,
  }
}

export interface PluginInstanceSearchCursor {
  createdAt: number
  id: string
}

export interface SearchPluginInstancesOptions {
  q?: string
  types?: string[]
  enabled?: boolean
  agentId?: string
  limit?: number
  cursor?: PluginInstanceSearchCursor | null
}

export interface SearchPluginInstancesResult {
  pluginInstances: PluginInstanceRecord[]
  plugin_instances: PluginInstanceRecord[]
  integrations: PluginInstanceRecord[]
  nextCursor: PluginInstanceSearchCursor | null
}

export interface PluginInstanceWithAgents extends PluginInstanceRecord {
  agents: { id: string; name: string }[]
}

export interface AgentPluginInstanceAssignmentRecord {
  agent_id: string
  plugin_instance_id: string
  created_at: number
  policy_json: string | null
}

export async function findPluginInstanceById(id: string): Promise<PluginInstanceRecord | null> {
  const db = getDb()
  const result = await db
    .selectFrom('plugin_instances')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return result ? toPluginInstanceRecord(result) : null
}

export async function findPluginInstancesByType(type: string): Promise<PluginInstanceRecord[]> {
  const db = getDb()
  const candidates = pluginTypeCandidates(type)
  if (candidates.length === 0) return []
  const rows = await db
    .selectFrom('plugin_instances')
    .selectAll()
    .where('plugin_instances.plugin_id', 'in', candidates)
    .execute()
  return rows.map(toPluginInstanceRecord)
}

export async function listPluginInstances(): Promise<PluginInstanceRecord[]> {
  const db = getDb()
  const rows = await db.selectFrom('plugin_instances').selectAll().execute()
  return rows.map(toPluginInstanceRecord)
}

export async function searchPluginInstances(
  opts: SearchPluginInstancesOptions = {}
): Promise<SearchPluginInstancesResult> {
  const db = getDb()
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100)
  let query = db.selectFrom('plugin_instances').selectAll()

  if (opts.types && opts.types.length > 0) {
    const pluginIds = opts.types.flatMap((type) => pluginTypeCandidates(type))
    if (pluginIds.length === 0) {
      return { pluginInstances: [], plugin_instances: [], integrations: [], nextCursor: null }
    }
    query = query.where('plugin_instances.plugin_id', 'in', pluginIds)
  }

  if (typeof opts.enabled === 'boolean') {
    query = query.where('plugin_instances.enabled', '=', opts.enabled ? 1 : 0)
  }

  if (opts.agentId) {
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('agent_plugin_instances')
          .select('agent_plugin_instances.agent_id')
          .whereRef('agent_plugin_instances.plugin_instance_id', '=', 'plugin_instances.id')
          .where('agent_plugin_instances.agent_id', '=', opts.agentId!)
      )
    )
  }

  const q = opts.q?.trim()
  if (q) {
    const lowered = q.toLowerCase()
    const like = `%${lowered}%`
    query = query.where((eb) =>
      eb.or([
        eb('plugin_instances.id', '=', q),
        sql<boolean>`lower(plugin_instances.name) like ${like}`,
        sql<boolean>`lower(plugin_instances.plugin_id) like ${like}`,
      ])
    )
  }

  if (opts.cursor) {
    query = query.where((eb) =>
      eb.or([
        eb('plugin_instances.created_at', '<', opts.cursor!.createdAt),
        eb.and([
          eb('plugin_instances.created_at', '=', opts.cursor!.createdAt),
          eb('plugin_instances.id', '<', opts.cursor!.id),
        ]),
      ])
    )
  }

  const rows = await query
    .orderBy('plugin_instances.created_at', 'desc')
    .orderBy('plugin_instances.id', 'desc')
    .limit(limit + 1)
    .execute()

  const hasMore = rows.length > limit
  const pluginInstances = (hasMore ? rows.slice(0, limit) : rows).map(toPluginInstanceRecord)
  const last = pluginInstances[pluginInstances.length - 1]

  return {
    pluginInstances,
    plugin_instances: pluginInstances,
    integrations: pluginInstances,
    nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
  }
}

export async function createPluginInstance(
  data: Omit<
    NewPluginInstance,
    'id' | 'created_at' | 'updated_at' | 'plugin_id' | 'config_json'
  > & {
    plugin_id?: string
    config_json?: string | null
    type?: string
    config?: string | null
  }
): Promise<PluginInstanceRecord> {
  const db = getDb()
  const id = uuid()
  const timestamp = now()
  const { type: legacyType, config: legacyConfig, plugin_id, config_json, ...rest } = data

  const result = await db
    .insertInto('plugin_instances')
    .values({
      id,
      ...rest,
      plugin_id: plugin_id ?? (legacyType ? `builtin.${legacyType}` : 'builtin.telegram'),
      config_json: config_json ?? legacyConfig ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return toPluginInstanceRecord(result)
}

export async function updatePluginInstance(
  id: string,
  data: Omit<PluginInstanceUpdate, 'id' | 'created_at'> & {
    type?: string
    config?: string | null
  }
): Promise<PluginInstanceRecord | null> {
  const db = getDb()
  const { type: legacyType, config: legacyConfig, plugin_id, config_json, ...rest } = data
  const patch: Record<string, unknown> = { ...rest }
  if (plugin_id !== undefined || legacyType !== undefined) {
    patch.plugin_id = plugin_id ?? `builtin.${legacyType}`
  }
  if (config_json !== undefined || legacyConfig !== undefined) {
    patch.config_json = config_json ?? legacyConfig
  }
  const result = await db
    .updateTable('plugin_instances')
    .set({ ...patch, updated_at: now() })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
  return result ? toPluginInstanceRecord(result) : null
}

export async function deletePluginInstance(id: string): Promise<boolean> {
  const db = getDb()
  const result = await db.deleteFrom('plugin_instances').where('id', '=', id).executeTakeFirst()
  return (result.numDeletedRows ?? 0n) > 0n
}

export async function getAgentsForPluginInstance(pluginInstanceId: string): Promise<Agent[]> {
  const db = getDb()

  const agents = await db
    .selectFrom('agent_plugin_instances')
    .innerJoin('agents', 'agents.id', 'agent_plugin_instances.agent_id')
    .selectAll('agents')
    .where('agent_plugin_instances.plugin_instance_id', '=', pluginInstanceId)
    .execute()

  return agents
}

export async function listAgentIdsForPluginInstance(pluginInstanceId: string): Promise<string[]> {
  const db = getDb()
  const rows = await db
    .selectFrom('agent_plugin_instances')
    .select(['agent_id'])
    .where('plugin_instance_id', '=', pluginInstanceId)
    .execute()

  return rows.map((row) => row.agent_id)
}

export async function setAgentPluginInstanceAssignment(params: {
  pluginInstanceId: string
  agentId: string
  enabled: boolean
  policyJson?: string | null
}): Promise<void> {
  const db = getDb()
  const timestamp = now()

  if (!params.enabled) {
    await db
      .deleteFrom('agent_plugin_instances')
      .where('plugin_instance_id', '=', params.pluginInstanceId)
      .where('agent_id', '=', params.agentId)
      .execute()
    return
  }

  await db
    .insertInto('agent_plugin_instances')
    .values({
      plugin_instance_id: params.pluginInstanceId,
      agent_id: params.agentId,
      created_at: timestamp,
      ...(params.policyJson !== undefined ? { policy_json: params.policyJson } : {}),
    })
    .onConflict((oc) => {
      const patch: Record<string, unknown> = {
        created_at: timestamp,
      }
      if (params.policyJson !== undefined) {
        patch.policy_json = params.policyJson
      }

      return oc.columns(['plugin_instance_id', 'agent_id']).doUpdateSet(patch)
    })
    .execute()
}

export async function getAgentPluginInstanceAssignment(params: {
  pluginInstanceId: string
  agentId: string
}): Promise<AgentPluginInstanceAssignmentRecord | null> {
  const db = getDb()

  const row = await db
    .selectFrom('agent_plugin_instances')
    .selectAll()
    .where('plugin_instance_id', '=', params.pluginInstanceId)
    .where('agent_id', '=', params.agentId)
    .executeTakeFirst()

  return row ?? null
}

export async function getPluginInstancesForAgent(
  agentId: string
): Promise<{ id: string; name: string; type: string; enabled: number }[]> {
  const db = getDb()

  const assignments = await db
    .selectFrom('agent_plugin_instances')
    .innerJoin(
      'plugin_instances',
      'plugin_instances.id',
      'agent_plugin_instances.plugin_instance_id'
    )
    .select([
      'plugin_instances.id',
      'plugin_instances.name',
      'plugin_instances.plugin_id',
      'plugin_instances.enabled',
    ])
    .where('agent_plugin_instances.agent_id', '=', agentId)
    .execute()

  return assignments.map((row) => ({
    id: row.id,
    name: row.name,
    type: inferTypeFromPluginId(row.plugin_id),
    enabled: row.enabled,
  }))
}

export async function listPluginInstancesWithAgents(): Promise<PluginInstanceWithAgents[]> {
  const db = getDb()

  const pluginInstances = await db.selectFrom('plugin_instances').selectAll().execute()

  const assignments = await db
    .selectFrom('agent_plugin_instances')
    .innerJoin('agents', 'agents.id', 'agent_plugin_instances.agent_id')
    .select([
      'agent_plugin_instances.plugin_instance_id',
      'agents.id as agent_id',
      'agents.name as agent_name',
    ])
    .execute()

  const agentsByPluginInstance: Record<string, { id: string; name: string }[]> = {}
  for (const row of assignments) {
    const list = (agentsByPluginInstance[row.plugin_instance_id] ??= [])
    list.push({ id: row.agent_id, name: row.agent_name })
  }

  return pluginInstances.map((pluginInstance) => ({
    ...toPluginInstanceRecord(pluginInstance),
    agents: agentsByPluginInstance[pluginInstance.id] || [],
  }))
}

export async function listAgentAssignmentsForPluginInstances(
  pluginInstanceIds: string[]
): Promise<Array<{ pluginInstanceId: string; agentId: string; agentName: string }>> {
  if (pluginInstanceIds.length === 0) return []
  const db = getDb()
  const rows = await db
    .selectFrom('agent_plugin_instances')
    .innerJoin('agents', 'agents.id', 'agent_plugin_instances.agent_id')
    .select([
      'agent_plugin_instances.plugin_instance_id as pluginInstanceId',
      'agents.id as agentId',
      'agents.name as agentName',
    ])
    .where('agent_plugin_instances.plugin_instance_id', 'in', pluginInstanceIds)
    .orderBy('agent_plugin_instances.plugin_instance_id', 'asc')
    .orderBy('agents.name', 'asc')
    .execute()

  return rows
}

/** @deprecated Use `PluginInstanceSearchCursor`. */
export type IntegrationSearchCursor = PluginInstanceSearchCursor
/** @deprecated Use `SearchPluginInstancesOptions`. */
export type SearchIntegrationsOptions = SearchPluginInstancesOptions
/** @deprecated Use `SearchPluginInstancesResult`. */
export type SearchIntegrationsResult = SearchPluginInstancesResult
/** @deprecated Use `PluginInstanceWithAgents`. */
export type IntegrationWithAgents = PluginInstanceWithAgents

/** @deprecated Use `findPluginInstanceById`. */
export async function findIntegrationById(id: string): Promise<PluginInstanceRecord | null> {
  return findPluginInstanceById(id)
}

/** @deprecated Use `findPluginInstancesByType`. */
export async function findIntegrationsByType(type: string): Promise<PluginInstanceRecord[]> {
  return findPluginInstancesByType(type)
}

/** @deprecated Use `listPluginInstances`. */
export async function listIntegrations(): Promise<PluginInstanceRecord[]> {
  return listPluginInstances()
}

/** @deprecated Use `searchPluginInstances`. */
export async function searchIntegrations(
  opts: SearchIntegrationsOptions = {}
): Promise<SearchIntegrationsResult> {
  return searchPluginInstances(opts)
}

/** @deprecated Use `createPluginInstance`. */
export async function createIntegration(
  data: Parameters<typeof createPluginInstance>[0]
): Promise<PluginInstanceRecord> {
  return createPluginInstance(data)
}

/** @deprecated Use `updatePluginInstance`. */
export async function updateIntegration(
  id: string,
  data: Parameters<typeof updatePluginInstance>[1]
): Promise<PluginInstanceRecord | null> {
  return updatePluginInstance(id, data)
}

/** @deprecated Use `deletePluginInstance`. */
export async function deleteIntegration(id: string): Promise<boolean> {
  return deletePluginInstance(id)
}

/** @deprecated Use `getAgentsForPluginInstance`. */
export async function getAgentsForIntegration(pluginInstanceId: string): Promise<Agent[]> {
  return getAgentsForPluginInstance(pluginInstanceId)
}

/** @deprecated Use `listAgentIdsForPluginInstance`. */
export async function listAgentIdsForIntegration(pluginInstanceId: string): Promise<string[]> {
  return listAgentIdsForPluginInstance(pluginInstanceId)
}

/** @deprecated Use `setAgentPluginInstanceAssignment`. */
export async function setAgentIntegrationAssignment(params: {
  pluginInstanceId: string
  agentId: string
  enabled: boolean
}): Promise<void> {
  return setAgentPluginInstanceAssignment(params)
}

/** @deprecated Use `getPluginInstancesForAgent`. */
export async function getIntegrationsForAgent(
  agentId: string
): Promise<{ id: string; name: string; type: string; enabled: number }[]> {
  return getPluginInstancesForAgent(agentId)
}

/** @deprecated Use `listPluginInstancesWithAgents`. */
export async function listIntegrationsWithAgents(): Promise<IntegrationWithAgents[]> {
  return listPluginInstancesWithAgents()
}

/** @deprecated Use `listAgentAssignmentsForPluginInstances`. */
export async function listAgentAssignmentsForIntegrations(
  integrationIds: string[]
): Promise<Array<{ pluginInstanceId: string; agentId: string; agentName: string }>> {
  return listAgentAssignmentsForPluginInstances(integrationIds)
}
