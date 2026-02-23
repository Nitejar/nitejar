import { sql } from 'kysely'
import { getDb } from '../db'
import type { Job, NewJob, JobUpdate } from '../types'
import { failStartingActivityByJobIds } from './activity-log'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

export async function findJobById(id: string): Promise<Job | null> {
  const db = getDb()
  const result = await db.selectFrom('jobs').selectAll().where('id', '=', id).executeTakeFirst()
  return result ?? null
}

export async function listJobsByWorkItem(workItemId: string): Promise<Job[]> {
  const db = getDb()
  return db
    .selectFrom('jobs')
    .selectAll()
    .where('work_item_id', '=', workItemId)
    .orderBy('created_at', 'desc')
    .execute()
}

export async function listJobsByAgent(agentId: string, limit = 100): Promise<Job[]> {
  const db = getDb()
  return db
    .selectFrom('jobs')
    .selectAll()
    .where('agent_id', '=', agentId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute()
}

export async function listJobs(limit = 100): Promise<Job[]> {
  const db = getDb()
  return db.selectFrom('jobs').selectAll().orderBy('created_at', 'desc').limit(limit).execute()
}

export async function createJob(
  data: Omit<NewJob, 'id' | 'created_at' | 'updated_at'>
): Promise<Job> {
  const db = getDb()
  const id = uuid()
  const timestamp = now()

  const result = await db
    .insertInto('jobs')
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

export async function updateJob(
  id: string,
  data: Omit<JobUpdate, 'id' | 'created_at'>
): Promise<Job | null> {
  const db = getDb()
  const result = await db
    .updateTable('jobs')
    .set({ ...data, updated_at: now() })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}

export async function startJob(id: string): Promise<Job | null> {
  return updateJob(id, { status: 'RUNNING', started_at: now() })
}

export async function completeJob(id: string): Promise<Job | null> {
  return updateJob(id, { status: 'COMPLETED', completed_at: now() })
}

export async function failJob(id: string, errorText: string): Promise<Job | null> {
  return updateJob(id, { status: 'FAILED', error_text: errorText, completed_at: now() })
}

export async function pauseJob(id: string): Promise<Job | null> {
  return updateJob(id, { status: 'PAUSED' })
}

export async function resumeJob(id: string): Promise<Job | null> {
  return updateJob(id, { status: 'RUNNING' })
}

export async function cancelJob(id: string, errorText: string): Promise<Job | null> {
  return updateJob(id, { status: 'CANCELLED', error_text: errorText, completed_at: now() })
}

/**
 * Find active (RUNNING or PENDING) jobs for a given session key.
 * Joins through work_items to match on session_key.
 */
export async function findActiveJobsForSession(sessionKey: string): Promise<Job[]> {
  const db = getDb()
  return db
    .selectFrom('jobs')
    .innerJoin('work_items', 'work_items.id', 'jobs.work_item_id')
    .selectAll('jobs')
    .where('work_items.session_key', '=', sessionKey)
    .where('jobs.status', 'in', ['RUNNING', 'PENDING'])
    .orderBy('jobs.created_at', 'desc')
    .execute()
}

export interface ActiveWorkSnapshot {
  job_id: string
  status: string
  work_item_id: string
  session_key: string
  source: string
  title: string
  created_at: number
}

export async function listActiveWorkSnapshotsForAgent(
  agentId: string,
  opts?: { excludeJobId?: string; limit?: number }
): Promise<ActiveWorkSnapshot[]> {
  const db = getDb()
  const limit = Math.min(Math.max(opts?.limit ?? 8, 1), 50)
  return db
    .selectFrom('jobs')
    .innerJoin('work_items', 'work_items.id', 'jobs.work_item_id')
    .select([
      'jobs.id as job_id',
      'jobs.status',
      'jobs.work_item_id',
      'work_items.session_key',
      'work_items.source',
      'work_items.title',
      'jobs.created_at',
    ])
    .where('jobs.agent_id', '=', agentId)
    .where('jobs.status', 'in', ['PENDING', 'RUNNING', 'PAUSED'])
    .$if(!!opts?.excludeJobId, (qb) => qb.where('jobs.id', '!=', opts!.excludeJobId!))
    .orderBy('jobs.created_at', 'desc')
    .limit(limit)
    .execute()
}

export interface RecentActivityEntry {
  job_id: string
  status: string
  created_at: number
  started_at: number | null
  completed_at: number | null
  agent_id: string
  agent_name: string
  agent_handle: string
  agent_config: string | null
  work_item_id: string
  work_item_created_at: number
  plugin_instance_id: string | null
  title: string
  source: string
  source_ref: string
  session_key: string
  prompt_tokens: number
  completion_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_cost: number
  call_count: number
  triage_summary: string | null
  triage_resources: string | null
  dispatch_status: string | null
  dispatch_control_state: string | null
  dispatch_control_reason: string | null
  queue_pending_count: number
  queue_included_count: number
  queue_dropped_count: number
  queue_cancelled_count: number
}

/**
 * Enriched job entries for the activity feed.
 * Joins jobs → work_items → agents, with aggregated inference_calls.
 */
export async function listRecentActivity(limit = 50): Promise<RecentActivityEntry[]> {
  const db = getDb()
  return db
    .selectFrom('jobs')
    .innerJoin('work_items', 'work_items.id', 'jobs.work_item_id')
    .innerJoin('agents', 'agents.id', 'jobs.agent_id')
    .leftJoin(
      db
        .selectFrom('inference_calls')
        .select([
          'job_id',
          sql<number>`coalesce(sum(prompt_tokens), 0)`.as('prompt_tokens'),
          sql<number>`coalesce(sum(completion_tokens), 0)`.as('completion_tokens'),
          sql<number>`coalesce(sum(cache_read_tokens), 0)`.as('cache_read_tokens'),
          sql<number>`coalesce(sum(cache_write_tokens), 0)`.as('cache_write_tokens'),
          sql<number>`coalesce(sum(cost_usd), 0)`.as('total_cost'),
          sql<number>`count(*)`.as('call_count'),
        ])
        .groupBy('job_id')
        .as('ic'),
      'ic.job_id',
      'jobs.id'
    )
    .leftJoin('activity_log', 'activity_log.job_id', 'jobs.id')
    .leftJoin(
      db
        .selectFrom('run_dispatches')
        .select(['job_id', sql<number>`max(created_at)`.as('latest_dispatch_created_at')])
        .where('job_id', 'is not', null)
        .groupBy('job_id')
        .as('rd_latest'),
      'rd_latest.job_id',
      'jobs.id'
    )
    .leftJoin('run_dispatches as rd', (join) =>
      join
        .onRef('rd.job_id', '=', 'jobs.id')
        .onRef('rd.created_at', '=', 'rd_latest.latest_dispatch_created_at')
    )
    .leftJoin(
      db
        .selectFrom('queue_messages')
        .select([
          'work_item_id',
          sql<number>`coalesce(sum(case when status = 'pending' then 1 else 0 end), 0)`.as(
            'queue_pending_count'
          ),
          sql<number>`coalesce(sum(case when status = 'included' then 1 else 0 end), 0)`.as(
            'queue_included_count'
          ),
          sql<number>`coalesce(sum(case when status = 'dropped' then 1 else 0 end), 0)`.as(
            'queue_dropped_count'
          ),
          sql<number>`coalesce(sum(case when status = 'cancelled' then 1 else 0 end), 0)`.as(
            'queue_cancelled_count'
          ),
        ])
        .groupBy('work_item_id')
        .as('qm'),
      'qm.work_item_id',
      'jobs.work_item_id'
    )
    .select([
      'jobs.id as job_id',
      'jobs.status',
      'jobs.created_at',
      'jobs.started_at',
      'jobs.completed_at',
      'jobs.agent_id',
      'agents.name as agent_name',
      'agents.handle as agent_handle',
      'agents.config as agent_config',
      'jobs.work_item_id',
      'work_items.created_at as work_item_created_at',
      'work_items.plugin_instance_id',
      'work_items.title',
      'work_items.source',
      'work_items.source_ref',
      'work_items.session_key',
      sql<number>`coalesce(ic.prompt_tokens, 0)`.as('prompt_tokens'),
      sql<number>`coalesce(ic.completion_tokens, 0)`.as('completion_tokens'),
      sql<number>`coalesce(ic.cache_read_tokens, 0)`.as('cache_read_tokens'),
      sql<number>`coalesce(ic.cache_write_tokens, 0)`.as('cache_write_tokens'),
      sql<number>`coalesce(ic.total_cost, 0)`.as('total_cost'),
      sql<number>`coalesce(ic.call_count, 0)`.as('call_count'),
      sql<string | null>`activity_log.summary`.as('triage_summary'),
      sql<string | null>`activity_log.resources`.as('triage_resources'),
      sql<string | null>`rd.status`.as('dispatch_status'),
      sql<string | null>`rd.control_state`.as('dispatch_control_state'),
      sql<string | null>`rd.control_reason`.as('dispatch_control_reason'),
      sql<number>`coalesce(qm.queue_pending_count, 0)`.as('queue_pending_count'),
      sql<number>`coalesce(qm.queue_included_count, 0)`.as('queue_included_count'),
      sql<number>`coalesce(qm.queue_dropped_count, 0)`.as('queue_dropped_count'),
      sql<number>`coalesce(qm.queue_cancelled_count, 0)`.as('queue_cancelled_count'),
    ])
    .orderBy('jobs.created_at', 'desc')
    .limit(limit)
    .execute()
}

// ============================================================================
// Run history (agent-facing)
// ============================================================================

export interface RunHistoryEntry {
  job_id: string
  status: string
  title: string
  source: string
  source_ref: string
  created_at: number
  started_at: number | null
  completed_at: number | null
  total_cost: number
  triage_summary: string | null
}

export interface RunSearchCursor {
  createdAt: number
  id: string
}

export interface SearchRunsOptions {
  q?: string
  statuses?: string[]
  agentId?: string
  workItemId?: string
  sources?: string[]
  pluginInstanceId?: string
  sessionKeyPrefix?: string
  createdAfter?: number
  createdBefore?: number
  limit?: number
  cursor?: RunSearchCursor | null
}

export interface SearchRunEntry {
  job_id: string
  status: string
  agent_id: string
  agent_name: string
  agent_handle: string
  work_item_id: string
  title: string
  source: string
  source_ref: string
  session_key: string
  plugin_instance_id: string | null
  error_text: string | null
  created_at: number
  started_at: number | null
  completed_at: number | null
  total_cost: number
  call_count: number
}

export interface SearchRunsResult {
  runs: SearchRunEntry[]
  nextCursor: RunSearchCursor | null
}

/**
 * Lightweight run history for a single agent.
 * Used by the `list_runs` tool so an agent can inspect its own past work.
 */
export async function listRunHistoryForAgent(
  agentId: string,
  opts?: {
    status?: string
    source?: string
    sinceUnix?: number
    limit?: number
  }
): Promise<RunHistoryEntry[]> {
  const db = getDb()
  const limit = Math.min(opts?.limit ?? 10, 50)

  let query = db
    .selectFrom('jobs')
    .innerJoin('work_items', 'work_items.id', 'jobs.work_item_id')
    .leftJoin(
      db
        .selectFrom('inference_calls')
        .select(['job_id', sql<number>`coalesce(sum(cost_usd), 0)`.as('total_cost')])
        .groupBy('job_id')
        .as('ic'),
      'ic.job_id',
      'jobs.id'
    )
    .leftJoin('activity_log', 'activity_log.job_id', 'jobs.id')
    .select([
      'jobs.id as job_id',
      'jobs.status',
      'work_items.title',
      'work_items.source',
      'work_items.source_ref',
      'jobs.created_at',
      'jobs.started_at',
      'jobs.completed_at',
      sql<number>`coalesce(ic.total_cost, 0)`.as('total_cost'),
      sql<string | null>`activity_log.summary`.as('triage_summary'),
    ])
    .where('jobs.agent_id', '=', agentId)

  if (opts?.status && opts.status !== 'all') {
    query = query.where('jobs.status', '=', opts.status.toUpperCase())
  }

  if (opts?.source) {
    query = query.where('work_items.source', '=', opts.source)
  }

  if (opts?.sinceUnix) {
    query = query.where('jobs.created_at', '>=', opts.sinceUnix)
  }

  return query.orderBy('jobs.created_at', 'desc').limit(limit).execute()
}

export async function searchRuns(opts: SearchRunsOptions = {}): Promise<SearchRunsResult> {
  const db = getDb()
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100)

  let query = db
    .selectFrom('jobs')
    .innerJoin('work_items', 'work_items.id', 'jobs.work_item_id')
    .innerJoin('agents', 'agents.id', 'jobs.agent_id')
    .leftJoin(
      db
        .selectFrom('inference_calls')
        .select([
          'job_id',
          sql<number>`coalesce(sum(cost_usd), 0)`.as('total_cost'),
          sql<number>`count(*)`.as('call_count'),
        ])
        .groupBy('job_id')
        .as('ic'),
      'ic.job_id',
      'jobs.id'
    )
    .select([
      'jobs.id as job_id',
      'jobs.status',
      'jobs.agent_id',
      'agents.name as agent_name',
      'agents.handle as agent_handle',
      'jobs.work_item_id',
      'work_items.title',
      'work_items.source',
      'work_items.source_ref',
      'work_items.session_key',
      'work_items.plugin_instance_id',
      'jobs.error_text',
      'jobs.created_at',
      'jobs.started_at',
      'jobs.completed_at',
      sql<number>`coalesce(ic.total_cost, 0)`.as('total_cost'),
      sql<number>`coalesce(ic.call_count, 0)`.as('call_count'),
    ])

  if (opts.statuses && opts.statuses.length > 0) {
    query = query.where('jobs.status', 'in', opts.statuses)
  }

  if (opts.agentId) {
    query = query.where('jobs.agent_id', '=', opts.agentId)
  }

  if (opts.workItemId) {
    query = query.where('jobs.work_item_id', '=', opts.workItemId)
  }

  if (opts.sources && opts.sources.length > 0) {
    query = query.where('work_items.source', 'in', opts.sources)
  }

  if (opts.pluginInstanceId) {
    query = query.where('work_items.plugin_instance_id', '=', opts.pluginInstanceId)
  }

  if (opts.sessionKeyPrefix) {
    query = query.where('work_items.session_key', 'like', `${opts.sessionKeyPrefix}%`)
  }

  if (typeof opts.createdAfter === 'number') {
    query = query.where('jobs.created_at', '>=', opts.createdAfter)
  }

  if (typeof opts.createdBefore === 'number') {
    query = query.where('jobs.created_at', '<=', opts.createdBefore)
  }

  const q = opts.q?.trim()
  if (q) {
    const lowered = q.toLowerCase()
    const like = `%${lowered}%`
    query = query.where((eb) =>
      eb.or([
        eb('jobs.id', '=', q),
        eb('jobs.work_item_id', '=', q),
        sql<boolean>`lower(work_items.title) like ${like}`,
        sql<boolean>`lower(work_items.source_ref) like ${like}`,
        sql<boolean>`lower(work_items.session_key) like ${like}`,
        sql<boolean>`lower(agents.handle) like ${like}`,
        sql<boolean>`lower(agents.name) like ${like}`,
      ])
    )
  }

  if (opts.cursor) {
    query = query.where((eb) =>
      eb.or([
        eb('jobs.created_at', '<', opts.cursor!.createdAt),
        eb.and([
          eb('jobs.created_at', '=', opts.cursor!.createdAt),
          eb('jobs.id', '<', opts.cursor!.id),
        ]),
      ])
    )
  }

  const rows = await query
    .orderBy('jobs.created_at', 'desc')
    .orderBy('jobs.id', 'desc')
    .limit(limit + 1)
    .execute()

  const hasMore = rows.length > limit
  const runs = (hasMore ? rows.slice(0, limit) : rows) as SearchRunEntry[]
  const last = runs[runs.length - 1]

  return {
    runs,
    nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.job_id } : null,
  }
}

/**
 * Mark old RUNNING jobs as FAILED. Call on startup to clean up
 * zombie jobs from previous crashes.
 */
export async function failZombieJobs(maxAgeSeconds: number = 3600): Promise<number> {
  const db = getDb()
  const cutoff = now() - maxAgeSeconds
  const zombieJobs = await db
    .selectFrom('jobs')
    .select('id')
    .where('status', '=', 'RUNNING')
    .where('created_at', '<', cutoff)
    .execute()
  const zombieJobIds = zombieJobs.map((job) => job.id)

  if (zombieJobIds.length === 0) {
    return 0
  }

  const result = await db
    .updateTable('jobs')
    .set({
      status: 'FAILED',
      error_text: 'Marked as zombie — process restarted while job was running',
      completed_at: now(),
      updated_at: now(),
    })
    .where('id', 'in', zombieJobIds)
    .executeTakeFirst()

  await failStartingActivityByJobIds(
    zombieJobIds,
    'Run interrupted: worker restarted while this run was in progress.'
  )

  const affected = Number(result.numUpdatedRows ?? 0)
  if (affected > 0) {
    console.log(`[jobs] Failed ${affected} zombie job(s) older than ${maxAgeSeconds}s`)
  }
  return affected
}
