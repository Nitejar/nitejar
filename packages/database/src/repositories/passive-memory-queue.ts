import { generateUuidV7 } from '@nitejar/core'
import { sql } from 'kysely'
import { getDb } from '../db'
import type { NewPassiveMemoryQueue, PassiveMemoryQueue } from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return generateUuidV7()
}

export async function enqueuePassiveMemoryQueue(
  data: Omit<NewPassiveMemoryQueue, 'id' | 'created_at' | 'updated_at'>
): Promise<{ row: PassiveMemoryQueue; created: boolean }> {
  const db = getDb()
  const ts = now()

  const result = await db
    .insertInto('passive_memory_queue')
    .values({
      id: uuid(),
      ...data,
      created_at: ts,
      updated_at: ts,
    })
    .onConflict((oc) => oc.column('job_id').doNothing())
    .executeTakeFirst()

  const row = await db
    .selectFrom('passive_memory_queue')
    .selectAll()
    .where('job_id', '=', data.job_id)
    .executeTakeFirstOrThrow()

  return {
    row,
    created: Number(result.numInsertedOrUpdatedRows ?? 0) > 0,
  }
}

export async function findPassiveMemoryQueueByJob(
  jobId: string
): Promise<PassiveMemoryQueue | null> {
  const db = getDb()
  const row = await db
    .selectFrom('passive_memory_queue')
    .selectAll()
    .where('job_id', '=', jobId)
    .executeTakeFirst()
  return row ?? null
}

export async function listPassiveMemoryQueueByWorkItem(
  workItemId: string,
  options?: { offset?: number; limit?: number }
): Promise<PassiveMemoryQueue[]> {
  const db = getDb()
  const offset = Math.max(0, options?.offset ?? 0)
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500)

  return db
    .selectFrom('passive_memory_queue')
    .selectAll()
    .where('work_item_id', '=', workItemId)
    .orderBy('created_at', 'desc')
    .offset(offset)
    .limit(limit)
    .execute()
}

export async function countPassiveMemoryQueueByWorkItem(workItemId: string): Promise<number> {
  const db = getDb()
  const row = await db
    .selectFrom('passive_memory_queue')
    .select((eb) => eb.fn.count<string>('id').as('count'))
    .where('work_item_id', '=', workItemId)
    .executeTakeFirst()

  return Number(row?.count ?? 0)
}

export async function claimNextPassiveMemoryQueue(
  workerId: string,
  opts?: { leaseSeconds?: number }
): Promise<PassiveMemoryQueue | null> {
  const db = getDb()
  const ts = now()
  const leaseSeconds = opts?.leaseSeconds ?? 180

  return db.transaction().execute(async (trx) => {
    const candidate = await trx
      .selectFrom('passive_memory_queue')
      .selectAll()
      .where((eb) =>
        eb.or([
          eb.and([
            eb('status', '=', 'pending'),
            eb.or([eb('next_attempt_at', 'is', null), eb('next_attempt_at', '<=', ts)]),
          ]),
          eb.and([
            eb('status', '=', 'failed'),
            sql<boolean>`attempt_count < max_attempts`,
            eb.or([eb('next_attempt_at', 'is', null), eb('next_attempt_at', '<=', ts)]),
          ]),
          eb.and([
            eb('status', '=', 'running'),
            eb('lease_expires_at', 'is not', null),
            eb('lease_expires_at', '<=', ts),
          ]),
        ])
      )
      .orderBy('created_at', 'asc')
      .limit(1)
      .executeTakeFirst()

    if (!candidate) return null

    const updated = await trx
      .updateTable('passive_memory_queue')
      .set({
        status: 'running',
        claimed_by: workerId,
        lease_expires_at: ts + leaseSeconds,
        attempt_count: candidate.attempt_count + 1,
        started_at: candidate.started_at ?? ts,
        updated_at: ts,
      })
      .where('id', '=', candidate.id)
      .where('status', '=', candidate.status)
      .where('attempt_count', '=', candidate.attempt_count)
      .returningAll()
      .executeTakeFirst()

    return updated ?? null
  })
}

export async function markPassiveMemoryQueueCompleted(
  id: string,
  summaryJson: string | null
): Promise<PassiveMemoryQueue | null> {
  const db = getDb()
  const ts = now()
  const row = await db
    .updateTable('passive_memory_queue')
    .set({
      status: 'completed',
      summary_json: summaryJson,
      lease_expires_at: null,
      completed_at: ts,
      updated_at: ts,
    })
    .where('id', '=', id)
    .where('status', '=', 'running')
    .returningAll()
    .executeTakeFirst()

  return row ?? null
}

export async function markPassiveMemoryQueueSkipped(
  id: string,
  summaryJson: string | null
): Promise<PassiveMemoryQueue | null> {
  const db = getDb()
  const ts = now()
  const row = await db
    .updateTable('passive_memory_queue')
    .set({
      status: 'skipped',
      summary_json: summaryJson,
      lease_expires_at: null,
      completed_at: ts,
      updated_at: ts,
    })
    .where('id', '=', id)
    .where('status', '=', 'running')
    .returningAll()
    .executeTakeFirst()

  return row ?? null
}

export async function listPassiveMemoryQueueByAgent(
  agentId: string,
  options?: { offset?: number; limit?: number; status?: string }
): Promise<PassiveMemoryQueue[]> {
  const db = getDb()
  const offset = Math.max(0, options?.offset ?? 0)
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 500)

  let query = db.selectFrom('passive_memory_queue').selectAll().where('agent_id', '=', agentId)

  if (options?.status) {
    query = query.where('status', '=', options.status)
  }

  return query.orderBy('created_at', 'desc').offset(offset).limit(limit).execute()
}

export async function countPassiveMemoryQueueByAgent(
  agentId: string,
  options?: { status?: string }
): Promise<Record<string, number>> {
  const db = getDb()

  if (options?.status) {
    const row = await db
      .selectFrom('passive_memory_queue')
      .select((eb) => eb.fn.count<string>('id').as('count'))
      .where('agent_id', '=', agentId)
      .where('status', '=', options.status)
      .executeTakeFirst()
    return { [options.status]: Number(row?.count ?? 0) }
  }

  const rows = await db
    .selectFrom('passive_memory_queue')
    .select(['status'])
    .select((eb) => eb.fn.count<string>('id').as('count'))
    .where('agent_id', '=', agentId)
    .groupBy('status')
    .execute()

  const counts: Record<string, number> = {}
  for (const row of rows) {
    counts[row.status] = Number(row.count)
  }
  return counts
}

export async function markPassiveMemoryQueueFailed(
  id: string,
  errorText: string,
  opts?: {
    retryable?: boolean
    retryDelaySeconds?: number | null
    summaryJson?: string | null
  }
): Promise<PassiveMemoryQueue | null> {
  const db = getDb()
  const ts = now()
  const retryDelaySeconds =
    opts?.retryable === true ? Math.max(1, Math.floor(opts?.retryDelaySeconds ?? 30)) : null

  const row = await db
    .updateTable('passive_memory_queue')
    .set({
      status: 'failed',
      last_error: errorText,
      next_attempt_at: retryDelaySeconds != null ? ts + retryDelaySeconds : null,
      summary_json: opts?.summaryJson ?? null,
      lease_expires_at: null,
      updated_at: ts,
    })
    .where('id', '=', id)
    .where('status', '=', 'running')
    .returningAll()
    .executeTakeFirst()

  return row ?? null
}
