import { sql } from 'kysely'
import { getDb } from '../db'
import { cosineSimilarity, deserializeEmbedding } from './memories'
import type { ActivityLogEntry, NewActivityLogEntry } from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

const DEFAULT_ACTIVITY_SUMMARY = 'Auto-derived reason: no reason provided'

export function normalizeActivitySummary(
  summary: string | null | undefined,
  fallbackSummary: string = DEFAULT_ACTIVITY_SUMMARY
): string {
  const normalized = typeof summary === 'string' ? summary.trim() : ''
  if (normalized.length > 0) return normalized

  const fallback = typeof fallbackSummary === 'string' ? fallbackSummary.trim() : ''
  if (fallback.length > 0) return fallback

  return DEFAULT_ACTIVITY_SUMMARY
}

export async function appendActivityEntry(
  data: Omit<NewActivityLogEntry, 'id' | 'created_at'>
): Promise<ActivityLogEntry> {
  const db = getDb()
  const id = uuid()

  const result = await db
    .insertInto('activity_log')
    .values({
      id,
      ...data,
      summary: normalizeActivitySummary(data.summary),
      created_at: now(),
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return result
}

/**
 * Find recent entries with status='starting' (ongoing work).
 */
export async function findRecentActiveEntries(
  maxAgeSeconds: number = 3600,
  limit: number = 20
): Promise<ActivityLogEntry[]> {
  const db = getDb()
  const cutoff = now() - maxAgeSeconds

  return db
    .selectFrom('activity_log')
    .selectAll()
    .where('status', '=', 'starting')
    .where('created_at', '>=', cutoff)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute()
}

/**
 * Exact-match lookup: find entries where any resource in the provided list
 * overlaps with the entry's resources JSON array.
 * Uses LIKE '%"resource_string"%' for SQLite compatibility.
 */
export async function findByResources(
  resources: string[],
  maxAgeSeconds: number = 3600
): Promise<ActivityLogEntry[]> {
  if (resources.length === 0) return []

  const db = getDb()
  const cutoff = now() - maxAgeSeconds

  let query = db
    .selectFrom('activity_log')
    .selectAll()
    .where('created_at', '>=', cutoff)
    .where('resources', 'is not', null)

  // Build OR conditions for each resource
  query = query.where((eb) => {
    const conditions = resources.map((r) => eb('resources', 'like', `%"${r}"%`))
    return eb.or(conditions)
  })

  return query.orderBy('created_at', 'desc').execute()
}

/**
 * Cosine similarity search on summary embeddings.
 * Done in application code for SQLite compatibility.
 */
export async function findSimilarActivityEntries(
  queryEmbedding: number[],
  maxAgeSeconds: number = 3600,
  limit: number = 10
): Promise<Array<ActivityLogEntry & { similarity: number }>> {
  const db = getDb()
  const cutoff = now() - maxAgeSeconds

  const entries = await db
    .selectFrom('activity_log')
    .selectAll()
    .where('created_at', '>=', cutoff)
    .where('embedding', 'is not', null)
    .execute()

  const scored = entries
    .map((entry) => {
      const embedding = deserializeEmbedding(entry.embedding)
      if (!embedding) return null
      const similarity = cosineSimilarity(queryEmbedding, embedding)
      return { ...entry, similarity }
    })
    .filter((e): e is ActivityLogEntry & { similarity: number } => e !== null)

  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, limit)
}

/**
 * Transition an activity entry's status (starting → completed/failed).
 */
export async function updateActivityStatus(
  id: string,
  newStatus: 'completed' | 'failed'
): Promise<ActivityLogEntry | null> {
  const db = getDb()
  const result = await db
    .updateTable('activity_log')
    .set({ status: newStatus })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}

/**
 * Mark in-flight activity entries for the given jobs as failed.
 * If summary is blank, set a deterministic fallback so UI always shows a reason.
 */
export async function failStartingActivityByJobIds(
  jobIds: string[],
  fallbackSummary: string
): Promise<number> {
  if (jobIds.length === 0) return 0

  const db = getDb()
  const safeFallback = normalizeActivitySummary(fallbackSummary)
  const result = await db
    .updateTable('activity_log')
    .set({
      status: 'failed',
      summary: sql<string>`case when trim(summary) = '' then ${safeFallback} else summary end`,
    })
    .where('status', '=', 'starting')
    .where('job_id', 'in', jobIds)
    .executeTakeFirst()

  return Number(result.numUpdatedRows ?? 0)
}

/**
 * Find the activity entry associated with a job ID.
 */
export async function findActivityByJobId(jobId: string): Promise<ActivityLogEntry | null> {
  const db = getDb()
  const result = await db
    .selectFrom('activity_log')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('created_at', 'desc')
    .executeTakeFirst()
  return result ?? null
}

/**
 * Batch lookup: find activity entries for multiple job IDs.
 * Avoids N+1 queries when rendering work item detail with multiple runs.
 */
export async function findActivityEntriesByJobIds(jobIds: string[]): Promise<ActivityLogEntry[]> {
  if (jobIds.length === 0) return []
  const db = getDb()
  return db.selectFrom('activity_log').selectAll().where('job_id', 'in', jobIds).execute()
}

/**
 * Query activity log with optional filters.
 * Used by the query_activity tool.
 */
export async function queryActivityLog(opts: {
  queryEmbedding?: number[]
  agentHandle?: string
  status?: string
  maxAgeSeconds?: number
  limit?: number
}): Promise<Array<ActivityLogEntry & { similarity?: number }>> {
  const maxAge = opts.maxAgeSeconds ?? 3600
  const limit = opts.limit ?? 10
  const db = getDb()
  const cutoff = now() - maxAge

  // If we have a query embedding, do similarity search
  if (opts.queryEmbedding) {
    const entries = await db
      .selectFrom('activity_log')
      .selectAll()
      .where('created_at', '>=', cutoff)
      .where('embedding', 'is not', null)
      .$if(!!opts.agentHandle, (qb) => qb.where('agent_handle', '=', opts.agentHandle!))
      .$if(!!opts.status, (qb) => qb.where('status', '=', opts.status!))
      .execute()

    const scored = entries
      .map((entry) => {
        const embedding = deserializeEmbedding(entry.embedding)
        if (!embedding) return null
        const similarity = cosineSimilarity(opts.queryEmbedding!, embedding)
        return { ...entry, similarity }
      })
      .filter((e): e is ActivityLogEntry & { similarity: number } => e !== null)

    scored.sort((a, b) => b.similarity - a.similarity)
    return scored.slice(0, limit)
  }

  // No embedding — return recent entries with filters
  return db
    .selectFrom('activity_log')
    .selectAll()
    .where('created_at', '>=', cutoff)
    .$if(!!opts.agentHandle, (qb) => qb.where('agent_handle', '=', opts.agentHandle!))
    .$if(!!opts.status, (qb) => qb.where('status', '=', opts.status!))
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute()
}

export interface LatestSessionActivityByAgent {
  agent_id: string
  agent_handle: string
  status: string
  summary: string
  created_at: number
}

/**
 * Latest activity-log (triage) entry per agent for a specific session.
 * Returns at most one row per requested agent ID, newest first per-agent.
 */
export async function listLatestSessionActivityByAgents(
  sessionKey: string,
  agentIds: string[],
  opts?: { maxAgeSeconds?: number }
): Promise<LatestSessionActivityByAgent[]> {
  if (!sessionKey || agentIds.length === 0) return []

  const db = getDb()
  const cutoff = now() - (opts?.maxAgeSeconds ?? 6 * 60 * 60)
  const rows = await db
    .selectFrom('activity_log')
    .select(['agent_id', 'agent_handle', 'status', 'summary', 'created_at'])
    .where('session_key', '=', sessionKey)
    .where('agent_id', 'in', agentIds)
    .where('created_at', '>=', cutoff)
    .orderBy('created_at', 'desc')
    .execute()

  const latestByAgent = new Map<string, LatestSessionActivityByAgent>()
  for (const row of rows) {
    if (latestByAgent.has(row.agent_id)) continue
    latestByAgent.set(row.agent_id, {
      agent_id: row.agent_id,
      agent_handle: row.agent_handle,
      status: row.status,
      summary: row.summary,
      created_at: row.created_at,
    })
  }

  return [...latestByAgent.values()]
}
