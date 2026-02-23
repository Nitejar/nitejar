import { sql } from 'kysely'
import { getDb } from '../db'
import type { Span, NewSpan } from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

// ============================================================================
// Write operations
// ============================================================================

export async function insertSpan(data: Omit<NewSpan, 'id' | 'created_at'>): Promise<Span> {
  const db = getDb()
  const id = uuid()

  const result = await db
    .insertInto('spans')
    .values({
      id,
      ...data,
      created_at: now(),
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return result
}

export async function completeSpan(
  id: string,
  updates: {
    end_time: number
    duration_ms: number
    status?: string
    attributes?: string | null
  }
): Promise<void> {
  const db = getDb()
  await db.updateTable('spans').set(updates).where('id', '=', id).execute()
}

// ============================================================================
// Read operations
// ============================================================================

export async function listSpansByJob(jobId: string): Promise<Span[]> {
  const db = getDb()
  return db
    .selectFrom('spans')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('start_time', 'asc')
    .execute()
}

export async function countSpansByJob(jobId: string): Promise<number> {
  const db = getDb()
  const result = await db
    .selectFrom('spans')
    .select((eb) => eb.fn.count<string>('id').as('count'))
    .where('job_id', '=', jobId)
    .executeTakeFirst()
  return Number(result?.count ?? 0)
}

export async function listSpansByJobPaged(
  jobId: string,
  options?: { offset?: number; limit?: number }
): Promise<Span[]> {
  const db = getDb()
  const offset = Math.max(0, options?.offset ?? 0)
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 1000)
  return db
    .selectFrom('spans')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('start_time', 'asc')
    .offset(offset)
    .limit(limit)
    .execute()
}

export async function getJobSpanSummary(jobId: string): Promise<{
  total_duration_ms: number
  turn_count: number
  tool_count: number
  error_count: number
}> {
  const db = getDb()

  const result = await db
    .selectFrom('spans')
    .select([
      sql<number>`coalesce(max(case when name = 'job' then duration_ms end), 0)`.as(
        'total_duration_ms'
      ),
      sql<number>`count(case when name = 'turn' then 1 end)`.as('turn_count'),
      sql<number>`count(case when name = 'tool_exec' then 1 end)`.as('tool_count'),
      sql<number>`count(case when status = 'error' then 1 end)`.as('error_count'),
    ])
    .where('job_id', '=', jobId)
    .executeTakeFirstOrThrow()

  return result
}
