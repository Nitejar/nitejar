import { getDb } from './db'
import type {
  WorkItem,
  WorkItemStore,
  CreateWorkItemInput,
  ListWorkItemsOptions,
} from '@nitejar/core'
import { generateUuidV7 } from '@nitejar/core'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- WorkItemStatus is an enum that may be used as a value
import { WorkItemStatus } from '@nitejar/core'
import type { WorkItem as DbWorkItem } from './types'

function dbRowToWorkItem(row: DbWorkItem): WorkItem {
  return {
    id: row.id,
    sessionKey: row.session_key,
    source: row.source as 'github' | 'manual',
    sourceRef: row.source_ref,
    status: row.status as WorkItemStatus,
    title: row.title,
    payload: row.payload ? JSON.parse(row.payload) : null,
    createdAt: new Date(row.created_at * 1000),
    updatedAt: new Date(row.updated_at * 1000),
  }
}

export class PostgresWorkItemStore implements WorkItemStore {
  async create(input: CreateWorkItemInput): Promise<WorkItem> {
    const db = getDb()
    const id = generateUuidV7()
    const timestamp = Math.floor(Date.now() / 1000)

    const result = await db
      .insertInto('work_items')
      .values({
        id,
        session_key: input.sessionKey,
        source: input.source,
        source_ref: input.sourceRef,
        title: input.title,
        payload: input.payload != null ? JSON.stringify(input.payload) : null,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    return dbRowToWorkItem(result)
  }

  async get(id: string): Promise<WorkItem | null> {
    const db = getDb()
    const result = await db
      .selectFrom('work_items')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()

    return result ? dbRowToWorkItem(result) : null
  }

  async list(options?: ListWorkItemsOptions): Promise<WorkItem[]> {
    const db = getDb()
    const { limit, cursor } = options ?? {}
    let query = db.selectFrom('work_items').selectAll().orderBy('id', 'desc')

    if (cursor) {
      query = query.where((eb) => eb('id', '<', cursor))
    }

    if (typeof limit === 'number') {
      query = query.limit(Math.max(0, limit))
    }

    const results = await query.execute()

    return results.map(dbRowToWorkItem)
  }

  async update(
    id: string,
    updates: Partial<Pick<WorkItem, 'status' | 'payload'>>
  ): Promise<WorkItem> {
    const db = getDb()
    const timestamp = Math.floor(Date.now() / 1000)

    const updateData: Record<string, unknown> = { updated_at: timestamp }

    if (updates.status !== undefined) {
      updateData.status = updates.status
    }

    if (updates.payload !== undefined) {
      updateData.payload = JSON.stringify(updates.payload)
    }

    const result = await db
      .updateTable('work_items')
      .set(updateData)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst()

    if (!result) {
      throw new Error(`WorkItem not found: ${id}`)
    }

    return dbRowToWorkItem(result)
  }
}
