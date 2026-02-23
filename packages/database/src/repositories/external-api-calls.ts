import { sql } from 'kysely'
import { getDb } from '../db'
import type { ExternalApiCall, NewExternalApiCall } from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

export async function insertExternalApiCall(
  data: Omit<NewExternalApiCall, 'id' | 'created_at'>
): Promise<ExternalApiCall> {
  const db = getDb()
  const id = uuid()

  const result = await db
    .insertInto('external_api_calls')
    .values({
      id,
      ...data,
      created_at: now(),
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return result
}

/** External API spend for a given agent in a specific time window. */
export async function getExternalSpendInWindow(
  sinceUnix: number,
  agentId?: string
): Promise<number> {
  const db = getDb()
  let query = db
    .selectFrom('external_api_calls')
    .select(sql<number>`coalesce(sum(cost_usd), 0)`.as('total'))
    .where('created_at', '>=', sinceUnix)

  if (agentId) {
    query = query.where('agent_id', '=', agentId)
  }

  const result = await query.executeTakeFirstOrThrow()
  return result.total
}

/** External API spend per agent, optionally filtered by time window. */
export async function getExternalSpendByAgent(
  sinceUnix?: number
): Promise<Array<{ agent_id: string; total: number; call_count: number }>> {
  const db = getDb()
  let query = db
    .selectFrom('external_api_calls')
    .select([
      'agent_id',
      sql<number>`coalesce(sum(cost_usd), 0)`.as('total'),
      sql<number>`count(*)`.as('call_count'),
    ])
    .groupBy('agent_id')
    .orderBy(sql`sum(cost_usd)`, 'desc')

  if (sinceUnix !== undefined) {
    query = query.where('created_at', '>=', sinceUnix)
  }

  return query.execute()
}

/** External API spend grouped by provider/operation/pricing status. */
export async function getExternalSpendByOperation(
  sinceUnix?: number,
  agentId?: string
): Promise<
  Array<{
    provider: string
    operation: string
    pricing_status: string
    total: number
    call_count: number
  }>
> {
  const db = getDb()
  let query = db
    .selectFrom('external_api_calls')
    .select([
      'provider',
      'operation',
      'pricing_status',
      sql<number>`coalesce(sum(cost_usd), 0)`.as('total'),
      sql<number>`count(*)`.as('call_count'),
    ])
    .groupBy(['provider', 'operation', 'pricing_status'])
    .orderBy(sql`sum(cost_usd)`, 'desc')

  if (sinceUnix !== undefined) {
    query = query.where('created_at', '>=', sinceUnix)
  }
  if (agentId) {
    query = query.where('agent_id', '=', agentId)
  }

  return query.execute()
}

/** Count external API calls whose pricing state is unknown. */
export async function countExternalCallsWithUnknownPricing(
  sinceUnix?: number,
  agentId?: string
): Promise<number> {
  const db = getDb()
  let query = db
    .selectFrom('external_api_calls')
    .select((eb) => eb.fn.count<string>('id').as('count'))
    .where('pricing_status', '=', 'unknown')

  if (sinceUnix !== undefined) {
    query = query.where('created_at', '>=', sinceUnix)
  }
  if (agentId) {
    query = query.where('agent_id', '=', agentId)
  }

  const result = await query.executeTakeFirst()
  return Number(result?.count ?? 0)
}

/** List all external API calls for a given job. */
export async function listExternalApiCallsByJob(jobId: string): Promise<ExternalApiCall[]> {
  const db = getDb()
  return db
    .selectFrom('external_api_calls')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('created_at', 'asc')
    .execute()
}

export async function countExternalApiCallsByJob(jobId: string): Promise<number> {
  const db = getDb()
  const result = await db
    .selectFrom('external_api_calls')
    .select((eb) => eb.fn.count<string>('id').as('count'))
    .where('job_id', '=', jobId)
    .executeTakeFirst()
  return Number(result?.count ?? 0)
}

export async function listExternalApiCallsByJobPaged(
  jobId: string,
  options?: { offset?: number; limit?: number }
): Promise<ExternalApiCall[]> {
  const db = getDb()
  const offset = Math.max(0, options?.offset ?? 0)
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 500)
  return db
    .selectFrom('external_api_calls')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('created_at', 'asc')
    .offset(offset)
    .limit(limit)
    .execute()
}
