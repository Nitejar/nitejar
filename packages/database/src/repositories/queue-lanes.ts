import { getDb } from '../db'
import type { QueueLane } from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function debounceUntil(arrivedAt: number, debounceMs: number): number {
  return arrivedAt + Math.max(1, Math.ceil(debounceMs / 1000))
}

export async function findQueueLaneByKey(queueKey: string): Promise<QueueLane | null> {
  const db = getDb()
  const lane = await db
    .selectFrom('queue_lanes')
    .selectAll()
    .where('queue_key', '=', queueKey)
    .executeTakeFirst()
  return lane ?? null
}

export async function upsertQueueLaneOnMessage(input: {
  queueKey: string
  sessionKey: string
  agentId: string
  pluginInstanceId: string | null
  arrivedAt: number
  debounceMs: number
  maxQueued: number
  mode?: string
}): Promise<QueueLane> {
  const db = getDb()
  const ts = now()
  const nextDebounce = debounceUntil(input.arrivedAt, input.debounceMs)

  const existing = await db
    .selectFrom('queue_lanes')
    .selectAll()
    .where('queue_key', '=', input.queueKey)
    .executeTakeFirst()

  if (!existing) {
    return db
      .insertInto('queue_lanes')
      .values({
        queue_key: input.queueKey,
        session_key: input.sessionKey,
        agent_id: input.agentId,
        plugin_instance_id: input.pluginInstanceId,
        state: 'queued',
        mode: input.mode ?? 'steer',
        is_paused: 0,
        debounce_until: nextDebounce,
        debounce_ms: input.debounceMs,
        max_queued: input.maxQueued,
        active_dispatch_id: null,
        paused_reason: null,
        paused_by: null,
        paused_at: null,
        created_at: ts,
        updated_at: ts,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  // On conflict (lane exists), do NOT overwrite mode — it persists from initial creation.
  const nextState = existing.state === 'running' ? 'running' : 'queued'

  return db
    .updateTable('queue_lanes')
    .set({
      session_key: input.sessionKey,
      agent_id: input.agentId,
      plugin_instance_id: input.pluginInstanceId,
      state: nextState,
      debounce_until: nextDebounce,
      debounce_ms: input.debounceMs,
      max_queued: input.maxQueued,
      updated_at: ts,
    })
    .where('queue_key', '=', input.queueKey)
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function pauseQueueLane(
  queueKey: string,
  reason: string,
  actor: string
): Promise<QueueLane | null> {
  const db = getDb()
  return db
    .updateTable('queue_lanes')
    .set({
      is_paused: 1,
      paused_reason: reason,
      paused_by: actor,
      paused_at: now(),
      updated_at: now(),
    })
    .where('queue_key', '=', queueKey)
    .returningAll()
    .executeTakeFirst()
    .then((row) => row ?? null)
}

export async function resumeQueueLane(queueKey: string): Promise<QueueLane | null> {
  const db = getDb()
  const lane = await findQueueLaneByKey(queueKey)
  if (!lane) return null

  let nextState = lane.state
  let nextDebounce = lane.debounce_until
  if (lane.state === 'running') {
    nextState = 'running'
  } else {
    nextState = lane.active_dispatch_id ? 'running' : 'queued'
    if (!nextDebounce) {
      nextDebounce = now()
    }
  }

  return db
    .updateTable('queue_lanes')
    .set({
      is_paused: 0,
      paused_reason: null,
      paused_by: null,
      paused_at: null,
      state: nextState,
      debounce_until: nextDebounce,
      updated_at: now(),
    })
    .where('queue_key', '=', queueKey)
    .returningAll()
    .executeTakeFirst()
    .then((row) => row ?? null)
}

export async function setQueueLaneRunning(
  queueKey: string,
  dispatchId: string
): Promise<QueueLane | null> {
  const db = getDb()
  return db
    .updateTable('queue_lanes')
    .set({
      state: 'running',
      active_dispatch_id: dispatchId,
      updated_at: now(),
    })
    .where('queue_key', '=', queueKey)
    .returningAll()
    .executeTakeFirst()
    .then((row) => row ?? null)
}

export async function finalizeQueueLaneAfterRun(queueKey: string): Promise<QueueLane | null> {
  const db = getDb()

  const lane = await findQueueLaneByKey(queueKey)
  if (!lane) return null

  const pending = await db
    .selectFrom('queue_messages')
    .select((eb) => eb.fn.count<string>('id').as('count'))
    .where('queue_key', '=', queueKey)
    .where('status', '=', 'pending')
    .executeTakeFirst()

  const pendingCount = Number(pending?.count ?? 0)

  const nextState = pendingCount > 0 ? 'queued' : 'idle'
  const nextDebounce = pendingCount > 0 ? debounceUntil(now(), lane.debounce_ms ?? 2000) : null

  return db
    .updateTable('queue_lanes')
    .set({
      state: nextState,
      active_dispatch_id: null,
      debounce_until: nextDebounce,
      updated_at: now(),
    })
    .where('queue_key', '=', queueKey)
    .returningAll()
    .executeTakeFirst()
    .then((row) => row ?? null)
}

export async function listActiveQueueLanes(limit = 100): Promise<QueueLane[]> {
  const db = getDb()
  return db
    .selectFrom('queue_lanes')
    .selectAll()
    .where('state', 'in', ['queued', 'running'])
    .orderBy('updated_at', 'desc')
    .limit(limit)
    .execute()
}
