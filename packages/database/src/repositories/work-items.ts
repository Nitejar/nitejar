import { sql, type Kysely } from 'kysely'
import { getDb } from '../db'
import type { Database, WorkItem, NewWorkItem, WorkItemUpdate } from '../types'
import { generateUuidV7 } from '@nitejar/core'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return generateUuidV7()
}

export async function findWorkItemById(id: string): Promise<WorkItem | null> {
  const db = getDb()
  const result = await db
    .selectFrom('work_items')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return result ?? null
}

export async function listWorkItems(limit = 100): Promise<WorkItem[]> {
  const db = getDb()
  return db.selectFrom('work_items').selectAll().orderBy('id', 'desc').limit(limit).execute()
}

export async function listWorkItemsByPluginInstance(
  pluginInstanceId: string,
  limit = 100
): Promise<WorkItem[]> {
  const db = getDb()
  return db
    .selectFrom('work_items')
    .selectAll()
    .where('plugin_instance_id', '=', pluginInstanceId)
    .orderBy('id', 'desc')
    .limit(limit)
    .execute()
}

/** @deprecated Use `listWorkItemsByPluginInstance`. */
export async function listWorkItemsByIntegration(
  pluginInstanceId: string,
  limit = 100
): Promise<WorkItem[]> {
  return listWorkItemsByPluginInstance(pluginInstanceId, limit)
}

export interface WorkItemSearchCursor {
  createdAt: number
  id: string
}

export interface SearchWorkItemsOptions {
  q?: string
  statuses?: string[]
  sources?: string[]
  pluginInstanceId?: string
  /** @deprecated Use `pluginInstanceId`. */
  integrationId?: string
  agentId?: string
  sessionKeyPrefix?: string
  createdAfter?: number
  createdBefore?: number
  limit?: number
  cursor?: WorkItemSearchCursor | null
}

export interface SearchWorkItemsResult {
  items: WorkItem[]
  nextCursor: WorkItemSearchCursor | null
}

export async function searchWorkItems(
  opts: SearchWorkItemsOptions = {}
): Promise<SearchWorkItemsResult> {
  const db = getDb()
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100)

  let query = db.selectFrom('work_items').selectAll()

  if (opts.statuses && opts.statuses.length > 0) {
    query = query.where('work_items.status', 'in', opts.statuses)
  }

  if (opts.sources && opts.sources.length > 0) {
    query = query.where('work_items.source', 'in', opts.sources)
  }

  const pluginInstanceId = opts.pluginInstanceId ?? opts.integrationId
  if (pluginInstanceId) {
    query = query.where('work_items.plugin_instance_id', '=', pluginInstanceId)
  }

  if (opts.agentId) {
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('jobs')
          .select('jobs.id')
          .whereRef('jobs.work_item_id', '=', 'work_items.id')
          .where('jobs.agent_id', '=', opts.agentId!)
      )
    )
  }

  if (opts.sessionKeyPrefix) {
    query = query.where('work_items.session_key', 'like', `${opts.sessionKeyPrefix}%`)
  }

  if (typeof opts.createdAfter === 'number') {
    query = query.where('work_items.created_at', '>=', opts.createdAfter)
  }

  if (typeof opts.createdBefore === 'number') {
    query = query.where('work_items.created_at', '<=', opts.createdBefore)
  }

  const q = opts.q?.trim()
  if (q) {
    const lowered = q.toLowerCase()
    const like = `%${lowered}%`
    query = query.where((eb) =>
      eb.or([
        eb('work_items.id', '=', q),
        sql<boolean>`lower(work_items.title) like ${like}`,
        sql<boolean>`lower(work_items.source_ref) like ${like}`,
        sql<boolean>`lower(work_items.session_key) like ${like}`,
        sql<boolean>`lower(work_items.source) like ${like}`,
      ])
    )
  }

  if (opts.cursor) {
    query = query.where((eb) =>
      eb.or([
        eb('work_items.created_at', '<', opts.cursor!.createdAt),
        eb.and([
          eb('work_items.created_at', '=', opts.cursor!.createdAt),
          eb('work_items.id', '<', opts.cursor!.id),
        ]),
      ])
    )
  }

  const rows = await query
    .orderBy('work_items.created_at', 'desc')
    .orderBy('work_items.id', 'desc')
    .limit(limit + 1)
    .execute()

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]

  return {
    items,
    nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
  }
}

export async function createWorkItem(
  data: Omit<NewWorkItem, 'id' | 'created_at' | 'updated_at'>,
  trx?: Kysely<Database>
): Promise<WorkItem> {
  const db = trx ?? getDb()
  const id = uuid()
  const timestamp = now()

  const result = await db
    .insertInto('work_items')
    .values({
      id,
      ...data,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return result
}

export async function updateWorkItem(
  id: string,
  data: Omit<WorkItemUpdate, 'id' | 'created_at'>
): Promise<WorkItem | null> {
  const db = getDb()
  const result = await db
    .updateTable('work_items')
    .set({ ...data, updated_at: now() })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}
