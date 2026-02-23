import type { Kysely } from 'kysely'
import { getDb } from '../db'
import type { Database, ScheduledItem, NewScheduledItem } from '../types'
import { generateUuidV7 } from '@nitejar/core'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return generateUuidV7()
}

export async function createScheduledItem(
  data: Omit<NewScheduledItem, 'id' | 'created_at'>,
  trx?: Kysely<Database>
): Promise<ScheduledItem> {
  const db = trx ?? getDb()
  const id = uuid()
  const timestamp = now()

  const result = await db
    .insertInto('scheduled_items')
    .values({
      id,
      ...data,
      created_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return result
}

export async function findScheduledItemById(id: string): Promise<ScheduledItem | null> {
  const db = getDb()
  const result = await db
    .selectFrom('scheduled_items')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return result ?? null
}

export async function listPendingScheduledItems(beforeTimestamp: number): Promise<ScheduledItem[]> {
  const db = getDb()
  return db
    .selectFrom('scheduled_items')
    .selectAll()
    .where('status', '=', 'pending')
    .where('run_at', '<=', beforeTimestamp)
    .orderBy('run_at', 'asc')
    .execute()
}

export async function listScheduledItemsByAgent(
  agentId: string,
  opts?: { sessionKey?: string }
): Promise<ScheduledItem[]> {
  const db = getDb()
  let query = db
    .selectFrom('scheduled_items')
    .selectAll()
    .where('agent_id', '=', agentId)
    .orderBy('run_at', 'asc')

  if (opts?.sessionKey) {
    query = query.where('session_key', '=', opts.sessionKey)
  }

  return query.execute()
}

/**
 * Atomically claim a pending item by moving it to 'firing'.
 * Returns null if the item was already claimed (not pending).
 */
export async function claimScheduledItem(id: string): Promise<ScheduledItem | null> {
  const db = getDb()
  const result = await db
    .updateTable('scheduled_items')
    .set({ status: 'firing', fired_at: now() })
    .where('id', '=', id)
    .where('status', '=', 'pending')
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}

/**
 * Confirm a claimed item as fired after successful enqueue.
 * Pass an optional `trx` to join an outer transaction.
 */
export async function confirmScheduledItemFired(
  id: string,
  trx?: Kysely<Database>
): Promise<ScheduledItem | null> {
  const db = trx ?? getDb()
  const result = await db
    .updateTable('scheduled_items')
    .set({ status: 'fired' })
    .where('id', '=', id)
    .where('status', '=', 'firing')
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}

/**
 * Roll back a claimed item to pending (e.g. after enqueue failure).
 */
export async function releaseScheduledItem(id: string): Promise<ScheduledItem | null> {
  const db = getDb()
  const result = await db
    .updateTable('scheduled_items')
    .set({ status: 'pending', fired_at: null })
    .where('id', '=', id)
    .where('status', '=', 'firing')
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}

/**
 * Recover items stuck in 'firing' for longer than staleSeconds.
 * Also recovers legacy rows where fired_at is null (pre-fix claims).
 * Returns the number of items reset to 'pending'.
 */
export async function recoverStaleFiringItems(staleSeconds: number): Promise<number> {
  const db = getDb()
  const cutoff = now() - staleSeconds
  const result = await db
    .updateTable('scheduled_items')
    .set({ status: 'pending', fired_at: null })
    .where('status', '=', 'firing')
    .where((eb) => eb.or([eb('fired_at', '<=', cutoff), eb('fired_at', 'is', null)]))
    .executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0)
}

/** @deprecated Use claimScheduledItem + confirmScheduledItemFired instead */
export async function markScheduledItemFired(id: string): Promise<ScheduledItem | null> {
  const db = getDb()
  const result = await db
    .updateTable('scheduled_items')
    .set({ status: 'fired', fired_at: now() })
    .where('id', '=', id)
    .where('status', '=', 'pending')
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}

export async function markScheduledItemCancelled(id: string): Promise<ScheduledItem | null> {
  const db = getDb()
  const result = await db
    .updateTable('scheduled_items')
    .set({ status: 'cancelled', cancelled_at: now() })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}
