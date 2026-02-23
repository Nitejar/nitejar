import type { Kysely } from 'kysely'
import { getDb } from '../db'
import type { Database, NewQueueMessage, QueueMessage } from '../types'
import { generateUuidV7 } from '@nitejar/core'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return generateUuidV7()
}

function debounceUntil(arrivedAt: number, debounceMs: number): number {
  return arrivedAt + Math.max(1, Math.ceil(debounceMs / 1000))
}

export async function createQueueMessage(
  data: Omit<NewQueueMessage, 'id' | 'created_at'>
): Promise<QueueMessage> {
  const db = getDb()
  const id = uuid()
  return db
    .insertInto('queue_messages')
    .values({
      id,
      ...data,
      created_at: now(),
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function listPendingQueueMessagesByQueue(
  queueKey: string,
  limit: number
): Promise<QueueMessage[]> {
  const db = getDb()
  return db
    .selectFrom('queue_messages')
    .selectAll()
    .where('queue_key', '=', queueKey)
    .where('status', '=', 'pending')
    .orderBy('arrived_at', 'asc')
    .orderBy('id', 'asc')
    .limit(limit)
    .execute()
}

export async function countPendingQueueMessagesByQueue(queueKey: string): Promise<number> {
  const db = getDb()
  const result = await db
    .selectFrom('queue_messages')
    .select((eb) => eb.fn.count<string>('id').as('count'))
    .where('queue_key', '=', queueKey)
    .where('status', '=', 'pending')
    .executeTakeFirst()
  return Number(result?.count ?? 0)
}

export async function markQueueMessagesIncluded(
  ids: string[],
  dispatchId: string
): Promise<number> {
  if (ids.length === 0) return 0
  const db = getDb()
  const result = await db
    .updateTable('queue_messages')
    .set({ status: 'included', dispatch_id: dispatchId })
    .where('id', 'in', ids)
    .where('status', '=', 'pending')
    .executeTakeFirst()

  return Number(result.numUpdatedRows ?? 0)
}

export async function cancelPendingQueueMessagesForQueue(
  queueKey: string,
  reason: string
): Promise<number> {
  const db = getDb()
  const result = await db
    .updateTable('queue_messages')
    .set({ status: 'cancelled', drop_reason: reason })
    .where('queue_key', '=', queueKey)
    .where('status', '=', 'pending')
    .executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0)
}

export async function dropPendingQueueMessagesForQueue(
  queueKey: string,
  reason: string
): Promise<number> {
  const db = getDb()
  const result = await db
    .updateTable('queue_messages')
    .set({ status: 'dropped', drop_reason: reason })
    .where('queue_key', '=', queueKey)
    .where('status', '=', 'pending')
    .executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0)
}

export async function dropPendingQueueMessagesByIds(
  ids: string[],
  reason: string
): Promise<number> {
  if (ids.length === 0) return 0
  const db = getDb()
  const result = await db
    .updateTable('queue_messages')
    .set({ status: 'dropped', drop_reason: reason })
    .where('id', 'in', ids)
    .where('status', '=', 'pending')
    .executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0)
}

/**
 * Consume pending messages for steering: atomically select all pending messages
 * for a queue key, mark them 'included' with the given dispatch ID, and return them.
 * Used by steer mode to inject mid-run or end-of-run messages.
 */
export async function consumeSteeringMessages(
  queueKey: string,
  dispatchId: string
): Promise<QueueMessage[]> {
  const db = getDb()
  const pending = await db
    .selectFrom('queue_messages')
    .selectAll()
    .where('queue_key', '=', queueKey)
    .where('status', '=', 'pending')
    .orderBy('arrived_at', 'asc')
    .orderBy('id', 'asc')
    .execute()

  if (pending.length === 0) return []

  await db
    .updateTable('queue_messages')
    .set({ status: 'included', dispatch_id: dispatchId })
    .where(
      'id',
      'in',
      pending.map((m) => m.id)
    )
    .where('status', '=', 'pending')
    .execute()

  return pending
}

export async function consumeSteeringMessagesByIds(
  ids: string[],
  dispatchId: string
): Promise<QueueMessage[]> {
  if (ids.length === 0) return []
  const db = getDb()
  const pending = await db
    .selectFrom('queue_messages')
    .selectAll()
    .where('id', 'in', ids)
    .where('status', '=', 'pending')
    .orderBy('arrived_at', 'asc')
    .orderBy('id', 'asc')
    .execute()

  if (pending.length === 0) return []

  await db
    .updateTable('queue_messages')
    .set({ status: 'included', dispatch_id: dispatchId })
    .where(
      'id',
      'in',
      pending.map((m) => m.id)
    )
    .where('status', '=', 'pending')
    .execute()

  return pending
}

/**
 * Atomically insert a queue message AND upsert its queue lane in a single
 * transaction. If either write fails the whole thing rolls back — no orphaned
 * messages without a lane to drive dispatch.
 *
 * Pass an optional `trx` to join an outer transaction (e.g. to also confirm
 * a scheduled item in the same atomic unit).
 */
export async function enqueueToLane(
  message: Omit<NewQueueMessage, 'id' | 'created_at'>,
  lane: {
    queueKey: string
    sessionKey: string
    agentId: string
    pluginInstanceId: string | null
    arrivedAt: number
    debounceMs: number
    maxQueued: number
    mode?: string
  },
  trx?: Kysely<Database>
): Promise<QueueMessage> {
  const doEnqueue = async (tx: Kysely<Database>): Promise<QueueMessage> => {
    const ts = now()
    const msgId = uuid()
    const nextDebounce = debounceUntil(lane.arrivedAt, lane.debounceMs)

    // 1. Insert queue message
    const queueMessage = await tx
      .insertInto('queue_messages')
      .values({
        id: msgId,
        ...message,
        created_at: ts,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    // 2. Upsert queue lane (same logic as upsertQueueLaneOnMessage)
    const existing = await tx
      .selectFrom('queue_lanes')
      .selectAll()
      .where('queue_key', '=', lane.queueKey)
      .executeTakeFirst()

    if (!existing) {
      await tx
        .insertInto('queue_lanes')
        .values({
          queue_key: lane.queueKey,
          session_key: lane.sessionKey,
          agent_id: lane.agentId,
          plugin_instance_id: lane.pluginInstanceId,
          state: 'queued',
          mode: lane.mode ?? 'steer',
          is_paused: 0,
          debounce_until: nextDebounce,
          debounce_ms: lane.debounceMs,
          max_queued: lane.maxQueued,
          active_dispatch_id: null,
          paused_reason: null,
          paused_by: null,
          paused_at: null,
          created_at: ts,
          updated_at: ts,
        })
        .execute()
    } else {
      const nextState = existing.state === 'running' ? 'running' : 'queued'
      await tx
        .updateTable('queue_lanes')
        .set({
          session_key: lane.sessionKey,
          agent_id: lane.agentId,
          plugin_instance_id: lane.pluginInstanceId,
          state: nextState,
          debounce_until: nextDebounce,
          debounce_ms: lane.debounceMs,
          max_queued: lane.maxQueued,
          updated_at: ts,
        })
        .where('queue_key', '=', lane.queueKey)
        .execute()
    }

    return queueMessage
  }

  // If caller provided a transaction, use it directly; otherwise create our own
  if (trx) {
    return doEnqueue(trx)
  }
  const db = getDb()
  return db.transaction().execute(doEnqueue)
}

export async function listQueueMessagesByDispatch(dispatchId: string): Promise<QueueMessage[]> {
  const db = getDb()
  return db
    .selectFrom('queue_messages')
    .selectAll()
    .where('dispatch_id', '=', dispatchId)
    .orderBy('arrived_at', 'asc')
    .orderBy('id', 'asc')
    .execute()
}

export async function countQueueMessagesByWorkItem(workItemId: string): Promise<number> {
  const db = getDb()
  const result = await db
    .selectFrom('queue_messages')
    .select((eb) => eb.fn.count<string>('id').as('count'))
    .where('work_item_id', '=', workItemId)
    .executeTakeFirst()
  return Number(result?.count ?? 0)
}

export async function listQueueMessagesByWorkItem(
  workItemId: string,
  options?: {
    offset?: number
    limit?: number
    statuses?: string[]
  }
): Promise<QueueMessage[]> {
  const db = getDb()
  const offset = Math.max(0, options?.offset ?? 0)
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 500)

  let query = db
    .selectFrom('queue_messages')
    .selectAll()
    .where('work_item_id', '=', workItemId)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .offset(offset)
    .limit(limit)

  if (options?.statuses && options.statuses.length > 0) {
    query = query.where('status', 'in', options.statuses)
  }

  return query.execute()
}
