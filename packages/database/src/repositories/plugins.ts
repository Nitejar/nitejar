import { getDb } from '../db'
import type {
  NewPluginDisclosureAck,
  NewPluginEvent,
  NewPluginVersion,
  Plugin,
  PluginDisclosureAck,
  PluginEvent,
  PluginUpdate,
  PluginVersion,
} from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

function normalizeScope(scope?: string | null): string {
  return scope?.trim() ?? ''
}

export async function listPlugins(): Promise<Plugin[]> {
  const db = getDb()
  return db.selectFrom('plugins').selectAll().orderBy('installed_at', 'desc').execute()
}

export async function findPluginById(pluginId: string): Promise<Plugin | null> {
  const db = getDb()
  const row = await db
    .selectFrom('plugins')
    .selectAll()
    .where('id', '=', pluginId)
    .executeTakeFirst()
  return row ?? null
}

export async function createPlugin(
  data: Omit<Plugin, 'enabled' | 'installed_at' | 'updated_at'> & {
    enabled?: boolean
    installedAt?: number
  }
): Promise<Plugin> {
  const db = getDb()
  const timestamp = data.installedAt ?? now()
  return db
    .insertInto('plugins')
    .values({
      id: data.id,
      name: data.name,
      enabled: data.enabled ? 1 : 0,
      trust_level: data.trust_level,
      source_kind: data.source_kind,
      source_ref: data.source_ref,
      current_version: data.current_version,
      current_checksum: data.current_checksum,
      current_install_path: data.current_install_path,
      manifest_json: data.manifest_json,
      config_json: data.config_json,
      last_load_error: data.last_load_error,
      last_loaded_at: data.last_loaded_at,
      installed_at: timestamp,
      updated_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function upsertPlugin(
  data: {
    id: string
    name: string
    trustLevel: string
    sourceKind: string
    sourceRef?: string | null
    currentVersion?: string | null
    currentChecksum?: string | null
    currentInstallPath?: string | null
    manifestJson: string
    configJson?: string | null
    enabled?: boolean
    lastLoadError?: string | null
    lastLoadedAt?: number | null
  },
  options?: { preserveEnabled?: boolean }
): Promise<Plugin> {
  const db = getDb()
  const timestamp = now()
  const existing = await findPluginById(data.id)
  const enabled = options?.preserveEnabled && existing ? existing.enabled : data.enabled ? 1 : 0

  if (!existing) {
    return db
      .insertInto('plugins')
      .values({
        id: data.id,
        name: data.name,
        enabled,
        trust_level: data.trustLevel,
        source_kind: data.sourceKind,
        source_ref: data.sourceRef ?? null,
        current_version: data.currentVersion ?? null,
        current_checksum: data.currentChecksum ?? null,
        current_install_path: data.currentInstallPath ?? null,
        manifest_json: data.manifestJson,
        config_json: data.configJson ?? null,
        last_load_error: data.lastLoadError ?? null,
        last_loaded_at: data.lastLoadedAt ?? null,
        installed_at: timestamp,
        updated_at: timestamp,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  return db
    .updateTable('plugins')
    .set({
      name: data.name,
      enabled,
      trust_level: data.trustLevel,
      source_kind: data.sourceKind,
      source_ref: data.sourceRef ?? null,
      current_version: data.currentVersion ?? null,
      current_checksum: data.currentChecksum ?? null,
      current_install_path: data.currentInstallPath ?? null,
      manifest_json: data.manifestJson,
      config_json: data.configJson ?? null,
      last_load_error: data.lastLoadError ?? null,
      last_loaded_at: data.lastLoadedAt ?? null,
      updated_at: timestamp,
    })
    .where('id', '=', data.id)
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function updatePlugin(
  pluginId: string,
  data: Omit<PluginUpdate, 'id' | 'installed_at'>
): Promise<Plugin | null> {
  const db = getDb()
  const row = await db
    .updateTable('plugins')
    .set({
      ...data,
      updated_at: now(),
    })
    .where('id', '=', pluginId)
    .returningAll()
    .executeTakeFirst()
  return row ?? null
}

export async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<Plugin | null> {
  return updatePlugin(pluginId, { enabled: enabled ? 1 : 0 })
}

/**
 * Permanently delete a plugin and all related data
 * (versions, disclosure acks, events, artifacts).
 */
export async function deletePlugin(pluginId: string): Promise<boolean> {
  const db = getDb()
  await db.deleteFrom('plugin_events').where('plugin_id', '=', pluginId).execute()
  await db.deleteFrom('plugin_disclosure_acks').where('plugin_id', '=', pluginId).execute()
  await db.deleteFrom('plugin_versions').where('plugin_id', '=', pluginId).execute()
  await db.deleteFrom('plugin_artifacts').where('plugin_id', '=', pluginId).execute()
  const result = await db.deleteFrom('plugins').where('id', '=', pluginId).executeTakeFirst()
  return (result.numDeletedRows ?? 0n) > 0n
}

export async function upsertPluginVersion(
  data: Omit<NewPluginVersion, 'installed_at'> & { installedAt?: number }
): Promise<PluginVersion> {
  const db = getDb()
  const installedAt = data.installedAt ?? now()
  const row = await db
    .insertInto('plugin_versions')
    .values({
      plugin_id: data.plugin_id,
      version: data.version,
      checksum: data.checksum,
      install_path: data.install_path,
      manifest_json: data.manifest_json,
      signature_json: data.signature_json ?? null,
      installed_at: installedAt,
    })
    .onConflict((oc) =>
      oc.columns(['plugin_id', 'version']).doUpdateSet({
        checksum: data.checksum,
        install_path: data.install_path,
        manifest_json: data.manifest_json,
        signature_json: data.signature_json ?? null,
        installed_at: installedAt,
      })
    )
    .returningAll()
    .executeTakeFirstOrThrow()

  return row
}

export async function listPluginVersions(pluginId: string): Promise<PluginVersion[]> {
  const db = getDb()
  return db
    .selectFrom('plugin_versions')
    .selectAll()
    .where('plugin_id', '=', pluginId)
    .orderBy('installed_at', 'desc')
    .orderBy('version', 'desc')
    .execute()
}

export async function listPluginDisclosureAcks(pluginId: string): Promise<PluginDisclosureAck[]> {
  const db = getDb()
  return db
    .selectFrom('plugin_disclosure_acks')
    .selectAll()
    .where('plugin_id', '=', pluginId)
    .orderBy('permission', 'asc')
    .orderBy('scope', 'asc')
    .execute()
}

export async function ensurePluginDisclosureRows(params: {
  pluginId: string
  permissions: Array<{ permission: string; scope?: string | null }>
}): Promise<void> {
  const db = getDb()
  if (params.permissions.length === 0) return

  const rows: NewPluginDisclosureAck[] = params.permissions.map((entry) => ({
    plugin_id: params.pluginId,
    permission: entry.permission,
    scope: normalizeScope(entry.scope),
    acknowledged: 0,
    acknowledged_at: null,
  }))

  await db
    .insertInto('plugin_disclosure_acks')
    .values(rows)
    .onConflict((oc) => oc.columns(['plugin_id', 'permission', 'scope']).doNothing())
    .execute()
}

export async function acknowledgePluginDisclosures(pluginId: string): Promise<void> {
  const db = getDb()
  await db
    .updateTable('plugin_disclosure_acks')
    .set({
      acknowledged: 1,
      acknowledged_at: now(),
    })
    .where('plugin_id', '=', pluginId)
    .where('acknowledged', '=', 0)
    .execute()
}

export interface PluginEventCursor {
  createdAt: number
  id: string
}

export interface ListPluginEventsOptions {
  pluginId: string
  limit?: number
  cursor?: PluginEventCursor | null
}

export interface ListPluginEventsResult {
  events: PluginEvent[]
  nextCursor: PluginEventCursor | null
}

export async function listRecentWebhookIngressEvents(limit = 25): Promise<PluginEvent[]> {
  const db = getDb()
  const boundedLimit = Math.min(Math.max(limit, 1), 200)
  return db
    .selectFrom('plugin_events')
    .selectAll()
    .where('kind', '=', 'webhook_ingress')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(boundedLimit)
    .execute()
}

export async function listWebhookIngressEventsByWorkItem(
  workItemId: string,
  limit = 100
): Promise<PluginEvent[]> {
  const db = getDb()
  const boundedLimit = Math.min(Math.max(limit, 1), 500)
  return db
    .selectFrom('plugin_events')
    .selectAll()
    .where('kind', '=', 'webhook_ingress')
    .where('work_item_id', '=', workItemId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(boundedLimit)
    .execute()
}

export async function listPluginEvents(
  options: ListPluginEventsOptions
): Promise<ListPluginEventsResult> {
  const db = getDb()
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100)

  let query = db.selectFrom('plugin_events').selectAll().where('plugin_id', '=', options.pluginId)

  if (options.cursor) {
    query = query.where((eb) =>
      eb.or([
        eb('created_at', '<', options.cursor!.createdAt),
        eb.and([
          eb('created_at', '=', options.cursor!.createdAt),
          eb('id', '<', options.cursor!.id),
        ]),
      ])
    )
  }

  const rows = await query
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit + 1)
    .execute()

  const hasMore = rows.length > limit
  const events = hasMore ? rows.slice(0, limit) : rows
  const tail = events[events.length - 1]

  return {
    events,
    nextCursor: hasMore && tail ? { createdAt: tail.created_at, id: tail.id } : null,
  }
}

export async function createPluginEvent(
  data: Omit<NewPluginEvent, 'id' | 'created_at'> & { id?: string; createdAt?: number }
): Promise<PluginEvent> {
  const db = getDb()
  const id = data.id ?? uuid()
  const createdAt = data.createdAt ?? now()
  return db
    .insertInto('plugin_events')
    .values({
      id,
      plugin_id: data.plugin_id,
      plugin_version: data.plugin_version ?? null,
      kind: data.kind,
      status: data.status,
      work_item_id: data.work_item_id ?? null,
      job_id: data.job_id ?? null,
      hook_name: data.hook_name ?? null,
      duration_ms: data.duration_ms ?? null,
      detail_json: data.detail_json ?? null,
      created_at: createdAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}
