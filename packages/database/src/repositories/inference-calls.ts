import { sql } from 'kysely'
import { getDb } from '../db'
import { PASSIVE_MEMORY_TURN_THRESHOLD } from '../passive-memory-turns'
import type { InferenceCall, NewInferenceCall } from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

// ============================================================================
// Write operations
// ============================================================================

export async function insertInferenceCall(
  data: Omit<NewInferenceCall, 'id' | 'created_at'>
): Promise<InferenceCall> {
  const db = getDb()
  const id = uuid()

  const result = await db
    .insertInto('inference_calls')
    .values({
      id,
      ...data,
      created_at: now(),
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return result
}

// ============================================================================
// Read / aggregation helpers
// ============================================================================

export async function listByJob(jobId: string): Promise<InferenceCall[]> {
  const db = getDb()
  return db
    .selectFrom('inference_calls')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('created_at', 'asc')
    .execute()
}

export async function countInferenceCallsByJob(jobId: string): Promise<number> {
  const db = getDb()
  const result = await db
    .selectFrom('inference_calls')
    .select((eb) => eb.fn.count<string>('id').as('count'))
    .where('job_id', '=', jobId)
    .executeTakeFirst()
  return Number(result?.count ?? 0)
}

export async function listInferenceCallsByJobPaged(
  jobId: string,
  options?: { offset?: number; limit?: number }
): Promise<InferenceCall[]> {
  const db = getDb()
  const offset = Math.max(0, options?.offset ?? 0)
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 500)
  return db
    .selectFrom('inference_calls')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('created_at', 'asc')
    .offset(offset)
    .limit(limit)
    .execute()
}

export interface InferenceCallWithPayloads extends InferenceCall {
  request_payload_json: string | null
  request_payload_metadata_json: string | null
  request_payload_byte_size: number | null
  response_payload_json: string | null
  response_payload_metadata_json: string | null
  response_payload_byte_size: number | null
}

export async function listInferenceCallsByJobWithPayloadsPaged(
  jobId: string,
  options?: { offset?: number; limit?: number }
): Promise<InferenceCallWithPayloads[]> {
  const db = getDb()
  const offset = Math.max(0, options?.offset ?? 0)
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 500)
  return db
    .selectFrom('inference_calls')
    .leftJoin(
      'model_call_payloads as request_payload',
      'request_payload.hash',
      'inference_calls.request_payload_hash'
    )
    .leftJoin(
      'model_call_payloads as response_payload',
      'response_payload.hash',
      'inference_calls.response_payload_hash'
    )
    .selectAll('inference_calls')
    .select([
      sql<string | null>`request_payload.payload_json`.as('request_payload_json'),
      sql<string | null>`request_payload.metadata_json`.as('request_payload_metadata_json'),
      sql<number | null>`request_payload.byte_size`.as('request_payload_byte_size'),
      sql<string | null>`response_payload.payload_json`.as('response_payload_json'),
      sql<string | null>`response_payload.metadata_json`.as('response_payload_metadata_json'),
      sql<number | null>`response_payload.byte_size`.as('response_payload_byte_size'),
    ])
    .where('inference_calls.job_id', '=', jobId)
    .orderBy('inference_calls.created_at', 'asc')
    .offset(offset)
    .limit(limit)
    .execute()
}

export async function listByAgent(agentId: string, limit = 200): Promise<InferenceCall[]> {
  const db = getDb()
  return db
    .selectFrom('inference_calls')
    .selectAll()
    .where('agent_id', '=', agentId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute()
}

/** Total spend across all agents, optionally filtered by time window. Includes external API costs. */
export async function getTotalSpend(sinceUnix?: number): Promise<number> {
  const db = getDb()
  let inferenceQuery = db
    .selectFrom('inference_calls')
    .select(sql<number>`coalesce(sum(cost_usd), 0)`.as('total'))

  let externalQuery = db
    .selectFrom('external_api_calls')
    .select(sql<number>`coalesce(sum(cost_usd), 0)`.as('total'))

  if (sinceUnix !== undefined) {
    inferenceQuery = inferenceQuery.where('created_at', '>=', sinceUnix)
    externalQuery = externalQuery.where('created_at', '>=', sinceUnix)
  }

  const [inferenceResult, externalResult] = await Promise.all([
    inferenceQuery.executeTakeFirstOrThrow(),
    externalQuery.executeTakeFirstOrThrow(),
  ])

  return inferenceResult.total + externalResult.total
}

/** Spend per agent, optionally filtered by time window. Includes external API costs. */
export async function getSpendByAgent(
  sinceUnix?: number
): Promise<Array<{ agent_id: string; total: number; call_count: number }>> {
  const db = getDb()
  let inferenceQuery = db
    .selectFrom('inference_calls')
    .select([
      'agent_id',
      sql<number>`coalesce(sum(cost_usd), 0)`.as('total'),
      sql<number>`count(*)`.as('call_count'),
    ])
    .groupBy('agent_id')

  let externalQuery = db
    .selectFrom('external_api_calls')
    .select([
      'agent_id',
      sql<number>`coalesce(sum(cost_usd), 0)`.as('total'),
      sql<number>`count(*)`.as('call_count'),
    ])
    .groupBy('agent_id')

  if (sinceUnix !== undefined) {
    inferenceQuery = inferenceQuery.where('created_at', '>=', sinceUnix)
    externalQuery = externalQuery.where('created_at', '>=', sinceUnix)
  }

  const [inferenceRows, externalRows] = await Promise.all([
    inferenceQuery.execute(),
    externalQuery.execute(),
  ])

  // Merge by agent_id
  const merged = new Map<string, { agent_id: string; total: number; call_count: number }>()
  for (const row of inferenceRows) {
    merged.set(row.agent_id, { ...row })
  }
  for (const row of externalRows) {
    const existing = merged.get(row.agent_id)
    if (existing) {
      existing.total += row.total
      existing.call_count += row.call_count
    } else {
      merged.set(row.agent_id, { ...row })
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.total - a.total)
}

/** Spend grouped by source (telegram, github, scheduler, etc.) for a given agent. */
export async function getSpendBySource(
  agentId: string,
  sinceUnix?: number
): Promise<Array<{ source: string; total: number; call_count: number }>> {
  const db = getDb()
  let query = db
    .selectFrom('inference_calls')
    .innerJoin('jobs', 'jobs.id', 'inference_calls.job_id')
    .innerJoin('work_items', 'work_items.id', 'jobs.work_item_id')
    .select([
      'work_items.source',
      sql<number>`coalesce(sum(inference_calls.cost_usd), 0)`.as('total'),
      sql<number>`count(*)`.as('call_count'),
    ])
    .where('inference_calls.agent_id', '=', agentId)
    .groupBy('work_items.source')
    .orderBy(sql`sum(inference_calls.cost_usd)`, 'desc')

  if (sinceUnix !== undefined) {
    query = query.where('inference_calls.created_at', '>=', sinceUnix)
  }

  return query.execute()
}

/** Spend grouped by source across all agents (for global costs page). */
export async function getSpendBySourceGlobal(
  sinceUnix?: number
): Promise<Array<{ source: string; total: number; call_count: number }>> {
  const db = getDb()
  let query = db
    .selectFrom('inference_calls')
    .innerJoin('jobs', 'jobs.id', 'inference_calls.job_id')
    .innerJoin('work_items', 'work_items.id', 'jobs.work_item_id')
    .select([
      'work_items.source',
      sql<number>`coalesce(sum(inference_calls.cost_usd), 0)`.as('total'),
      sql<number>`count(*)`.as('call_count'),
    ])
    .groupBy('work_items.source')
    .orderBy(sql`sum(inference_calls.cost_usd)`, 'desc')

  if (sinceUnix !== undefined) {
    query = query.where('inference_calls.created_at', '>=', sinceUnix)
  }

  return query.execute()
}

/** Top N most expensive jobs. */
export async function getTopExpensiveJobs(
  limit = 20,
  sinceUnix?: number
): Promise<
  Array<{
    job_id: string
    agent_id: string
    work_item_id: string
    total_cost: number
    prompt_tokens: number
    completion_tokens: number
    cache_read_tokens: number
    cache_write_tokens: number
    call_count: number
    source: string
    title: string
  }>
> {
  const db = getDb()
  let query = db
    .selectFrom('inference_calls')
    .innerJoin('jobs', 'jobs.id', 'inference_calls.job_id')
    .innerJoin('work_items', 'work_items.id', 'jobs.work_item_id')
    .select([
      'inference_calls.job_id',
      'inference_calls.agent_id',
      'jobs.work_item_id',
      sql<number>`coalesce(sum(inference_calls.cost_usd), 0)`.as('total_cost'),
      sql<number>`coalesce(sum(inference_calls.prompt_tokens), 0)`.as('prompt_tokens'),
      sql<number>`coalesce(sum(inference_calls.completion_tokens), 0)`.as('completion_tokens'),
      sql<number>`coalesce(sum(inference_calls.cache_read_tokens), 0)`.as('cache_read_tokens'),
      sql<number>`coalesce(sum(inference_calls.cache_write_tokens), 0)`.as('cache_write_tokens'),
      sql<number>`count(*)`.as('call_count'),
      'work_items.source',
      'work_items.title',
    ])
    .groupBy('inference_calls.job_id')
    .orderBy(sql`sum(inference_calls.cost_usd)`, 'desc')
    .limit(limit)

  if (sinceUnix !== undefined) {
    query = query.where('inference_calls.created_at', '>=', sinceUnix)
  }

  return query.execute()
}

/** Daily cost trend — returns rows with { date, total_cost, call_count }. Includes external API costs. */
export async function getDailyTrend(
  days = 30,
  agentId?: string
): Promise<Array<{ date: string; total_cost: number; call_count: number }>> {
  const db = getDb()
  const sinceUnix = now() - days * 86400

  let inferenceQuery = db
    .selectFrom('inference_calls')
    .select([
      sql<string>`date(created_at, 'unixepoch')`.as('date'),
      sql<number>`coalesce(sum(cost_usd), 0)`.as('total_cost'),
      sql<number>`count(*)`.as('call_count'),
    ])
    .where('created_at', '>=', sinceUnix)
    .groupBy(sql`date(created_at, 'unixepoch')`)

  let externalQuery = db
    .selectFrom('external_api_calls')
    .select([
      sql<string>`date(created_at, 'unixepoch')`.as('date'),
      sql<number>`coalesce(sum(cost_usd), 0)`.as('total_cost'),
      sql<number>`count(*)`.as('call_count'),
    ])
    .where('created_at', '>=', sinceUnix)
    .groupBy(sql`date(created_at, 'unixepoch')`)

  if (agentId) {
    inferenceQuery = inferenceQuery.where('agent_id', '=', agentId)
    externalQuery = externalQuery.where('agent_id', '=', agentId)
  }

  const [inferenceRows, externalRows] = await Promise.all([
    inferenceQuery.execute(),
    externalQuery.execute(),
  ])

  // Merge by date
  const merged = new Map<string, { date: string; total_cost: number; call_count: number }>()
  for (const row of inferenceRows) {
    merged.set(row.date, { ...row })
  }
  for (const row of externalRows) {
    const existing = merged.get(row.date)
    if (existing) {
      existing.total_cost += row.total_cost
      existing.call_count += row.call_count
    } else {
      merged.set(row.date, { ...row })
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date))
}

/** Top N most expensive jobs for a specific agent. */
export async function getTopExpensiveJobsForAgent(
  agentId: string,
  limit = 20
): Promise<
  Array<{
    job_id: string
    agent_id: string
    work_item_id: string
    total_cost: number
    prompt_tokens: number
    completion_tokens: number
    cache_read_tokens: number
    cache_write_tokens: number
    call_count: number
    source: string
    title: string
  }>
> {
  const db = getDb()
  return db
    .selectFrom('inference_calls')
    .innerJoin('jobs', 'jobs.id', 'inference_calls.job_id')
    .innerJoin('work_items', 'work_items.id', 'jobs.work_item_id')
    .select([
      'inference_calls.job_id',
      'inference_calls.agent_id',
      'jobs.work_item_id',
      sql<number>`coalesce(sum(inference_calls.cost_usd), 0)`.as('total_cost'),
      sql<number>`coalesce(sum(inference_calls.prompt_tokens), 0)`.as('prompt_tokens'),
      sql<number>`coalesce(sum(inference_calls.completion_tokens), 0)`.as('completion_tokens'),
      sql<number>`coalesce(sum(inference_calls.cache_read_tokens), 0)`.as('cache_read_tokens'),
      sql<number>`coalesce(sum(inference_calls.cache_write_tokens), 0)`.as('cache_write_tokens'),
      sql<number>`count(*)`.as('call_count'),
      'work_items.source',
      'work_items.title',
    ])
    .where('inference_calls.agent_id', '=', agentId)
    .groupBy('inference_calls.job_id')
    .orderBy(sql`sum(inference_calls.cost_usd)`, 'desc')
    .limit(limit)
    .execute()
}

/** Aggregate cost per work item for a batch of work item IDs. Includes external API costs. */
export async function getCostByWorkItems(workItemIds: string[]): Promise<
  Array<{
    work_item_id: string
    total_cost: number
    prompt_tokens: number
    completion_tokens: number
    cache_read_tokens: number
    cache_write_tokens: number
  }>
> {
  if (workItemIds.length === 0) return []
  const db = getDb()

  const [inferenceRows, externalRows] = await Promise.all([
    db
      .selectFrom('inference_calls')
      .innerJoin('jobs', 'jobs.id', 'inference_calls.job_id')
      .select([
        'jobs.work_item_id',
        sql<number>`coalesce(sum(inference_calls.cost_usd), 0)`.as('total_cost'),
        sql<number>`coalesce(sum(inference_calls.prompt_tokens), 0)`.as('prompt_tokens'),
        sql<number>`coalesce(sum(inference_calls.completion_tokens), 0)`.as('completion_tokens'),
        sql<number>`coalesce(sum(inference_calls.cache_read_tokens), 0)`.as('cache_read_tokens'),
        sql<number>`coalesce(sum(inference_calls.cache_write_tokens), 0)`.as('cache_write_tokens'),
      ])
      .where('jobs.work_item_id', 'in', workItemIds)
      .groupBy('jobs.work_item_id')
      .execute(),
    db
      .selectFrom('external_api_calls')
      .innerJoin('jobs', 'jobs.id', 'external_api_calls.job_id')
      .select([
        'jobs.work_item_id',
        sql<number>`coalesce(sum(external_api_calls.cost_usd), 0)`.as('total_cost'),
      ])
      .where('jobs.work_item_id', 'in', workItemIds)
      .groupBy('jobs.work_item_id')
      .execute(),
  ])

  const merged = new Map<
    string,
    {
      work_item_id: string
      total_cost: number
      prompt_tokens: number
      completion_tokens: number
      cache_read_tokens: number
      cache_write_tokens: number
    }
  >()
  for (const row of inferenceRows) {
    merged.set(row.work_item_id, { ...row })
  }
  for (const row of externalRows) {
    const existing = merged.get(row.work_item_id)
    if (existing) {
      existing.total_cost += row.total_cost
    } else {
      merged.set(row.work_item_id, {
        work_item_id: row.work_item_id,
        total_cost: row.total_cost,
        prompt_tokens: 0,
        completion_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      })
    }
  }

  return Array.from(merged.values())
}

export interface JobCostSummary {
  job_id: string
  total_cost: number
  prompt_tokens: number
  completion_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  call_count: number
  /** Cost attributed to passive memory extraction (turn >= 10000). */
  passive_memory_cost: number
  /** Cost attributed to external tool/API calls. */
  external_cost: number
}

/** Aggregate cost per job for a batch of job IDs. Includes external API costs. */
export async function getCostByJobs(jobIds: string[]): Promise<JobCostSummary[]> {
  if (jobIds.length === 0) return []
  const db = getDb()

  const [inferenceRows, passiveRows, externalRows] = await Promise.all([
    db
      .selectFrom('inference_calls')
      .select([
        'job_id',
        sql<number>`coalesce(sum(cost_usd), 0)`.as('total_cost'),
        sql<number>`coalesce(sum(prompt_tokens), 0)`.as('prompt_tokens'),
        sql<number>`coalesce(sum(completion_tokens), 0)`.as('completion_tokens'),
        sql<number>`coalesce(sum(cache_read_tokens), 0)`.as('cache_read_tokens'),
        sql<number>`coalesce(sum(cache_write_tokens), 0)`.as('cache_write_tokens'),
        sql<number>`count(*)`.as('call_count'),
      ])
      .where('job_id', 'in', jobIds)
      .groupBy('job_id')
      .execute(),
    db
      .selectFrom('inference_calls')
      .select(['job_id', sql<number>`coalesce(sum(cost_usd), 0)`.as('total_cost')])
      .where('job_id', 'in', jobIds)
      .where('turn', '>=', PASSIVE_MEMORY_TURN_THRESHOLD)
      .groupBy('job_id')
      .execute(),
    db
      .selectFrom('external_api_calls')
      .select([
        'job_id',
        sql<number>`coalesce(sum(cost_usd), 0)`.as('total_cost'),
        sql<number>`count(*)`.as('call_count'),
      ])
      .where('job_id', 'in', jobIds)
      .groupBy('job_id')
      .execute(),
  ])

  const passiveMap = new Map(passiveRows.map((r) => [r.job_id, r.total_cost]))
  const externalMap = new Map(externalRows.map((r) => [r.job_id, r]))

  const merged = new Map<string, JobCostSummary>()
  for (const row of inferenceRows) {
    const ext = externalMap.get(row.job_id)
    merged.set(row.job_id, {
      ...row,
      total_cost: row.total_cost + (ext?.total_cost ?? 0),
      call_count: row.call_count + (ext?.call_count ?? 0),
      passive_memory_cost: passiveMap.get(row.job_id) ?? 0,
      external_cost: ext?.total_cost ?? 0,
    })
  }
  // Jobs with only external costs (no inference calls)
  for (const row of externalRows) {
    if (!merged.has(row.job_id)) {
      merged.set(row.job_id, {
        job_id: row.job_id,
        total_cost: row.total_cost,
        prompt_tokens: 0,
        completion_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        call_count: row.call_count,
        passive_memory_cost: 0,
        external_cost: row.total_cost,
      })
    }
  }

  return Array.from(merged.values())
}

/** Spend for a given agent in a specific time window (for cost limit checks). Includes external API costs. */
export async function getAgentSpendInWindow(agentId: string, sinceUnix: number): Promise<number> {
  const db = getDb()
  const [inferenceResult, externalResult] = await Promise.all([
    db
      .selectFrom('inference_calls')
      .select(sql<number>`coalesce(sum(cost_usd), 0)`.as('total'))
      .where('agent_id', '=', agentId)
      .where('created_at', '>=', sinceUnix)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('external_api_calls')
      .select(sql<number>`coalesce(sum(cost_usd), 0)`.as('total'))
      .where('agent_id', '=', agentId)
      .where('created_at', '>=', sinceUnix)
      .executeTakeFirstOrThrow(),
  ])

  return inferenceResult.total + externalResult.total
}

/** Spend for all agents in a team in a specific time window. Includes external API costs. */
export async function getTeamSpendInWindow(teamId: string, sinceUnix: number): Promise<number> {
  const db = getDb()
  const [inferenceResult, externalResult] = await Promise.all([
    db
      .selectFrom('inference_calls')
      .innerJoin('agent_teams', 'agent_teams.agent_id', 'inference_calls.agent_id')
      .select(sql<number>`coalesce(sum(inference_calls.cost_usd), 0)`.as('total'))
      .where('agent_teams.team_id', '=', teamId)
      .where('inference_calls.created_at', '>=', sinceUnix)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('external_api_calls')
      .innerJoin('agent_teams', 'agent_teams.agent_id', 'external_api_calls.agent_id')
      .select(sql<number>`coalesce(sum(external_api_calls.cost_usd), 0)`.as('total'))
      .where('agent_teams.team_id', '=', teamId)
      .where('external_api_calls.created_at', '>=', sinceUnix)
      .executeTakeFirstOrThrow(),
  ])

  return inferenceResult.total + externalResult.total
}

/** Spend across all agents (org-wide) in a specific time window. Includes external API costs. */
export async function getOrgSpendInWindow(sinceUnix: number): Promise<number> {
  const db = getDb()
  const [inferenceResult, externalResult] = await Promise.all([
    db
      .selectFrom('inference_calls')
      .select(sql<number>`coalesce(sum(cost_usd), 0)`.as('total'))
      .where('created_at', '>=', sinceUnix)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('external_api_calls')
      .select(sql<number>`coalesce(sum(cost_usd), 0)`.as('total'))
      .where('created_at', '>=', sinceUnix)
      .executeTakeFirstOrThrow(),
  ])

  return inferenceResult.total + externalResult.total
}
