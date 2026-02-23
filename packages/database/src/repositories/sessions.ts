import { getDb } from '../db'
import type { SessionSummary, NewSessionSummary, SessionSummaryUpdate } from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

/**
 * Find a session summary by ID
 */
export async function findSessionSummaryById(id: string): Promise<SessionSummary | null> {
  const db = getDb()
  const result = await db
    .selectFrom('session_summaries')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return result ?? null
}

/**
 * Find the most recent session summary for a session
 */
export async function findLatestSessionSummary(
  sessionKey: string,
  agentId?: string,
  options?: {
    beforeTimestamp?: number
  }
): Promise<SessionSummary | null> {
  const db = getDb()
  let query = db.selectFrom('session_summaries').selectAll().where('session_key', '=', sessionKey)

  if (agentId) {
    query = query.where('agent_id', '=', agentId)
  }

  if (options?.beforeTimestamp != null) {
    query = query.where('compacted_at', '<=', options.beforeTimestamp)
  }

  const result = await query.orderBy('compacted_at', 'desc').limit(1).executeTakeFirst()

  return result ?? null
}

/**
 * List session summaries for an agent
 */
export async function listSessionSummaries(
  agentId: string,
  options?: {
    limit?: number
    sessionKey?: string
  }
): Promise<SessionSummary[]> {
  const db = getDb()
  let query = db
    .selectFrom('session_summaries')
    .selectAll()
    .where('agent_id', '=', agentId)
    .orderBy('compacted_at', 'desc')

  if (options?.sessionKey) {
    query = query.where('session_key', '=', options.sessionKey)
  }

  if (options?.limit != null) {
    query = query.limit(options.limit)
  }

  return query.execute()
}

/**
 * Create a new session summary
 */
export async function createSessionSummary(
  data: Omit<NewSessionSummary, 'id' | 'compacted_at'>
): Promise<SessionSummary> {
  const db = getDb()
  const id = uuid()
  const timestamp = now()

  const result = await db
    .insertInto('session_summaries')
    .values({
      id,
      ...data,
      compacted_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return result
}

/**
 * Update a session summary
 */
export async function updateSessionSummary(
  id: string,
  data: Omit<SessionSummaryUpdate, 'id' | 'compacted_at'>
): Promise<SessionSummary | null> {
  const db = getDb()
  const result = await db
    .updateTable('session_summaries')
    .set(data)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}

/**
 * Delete a session summary
 */
export async function deleteSessionSummary(id: string): Promise<boolean> {
  const db = getDb()
  const result = await db.deleteFrom('session_summaries').where('id', '=', id).executeTakeFirst()
  return (result.numDeletedRows ?? 0) > 0
}

/**
 * Delete all session summaries for a session
 */
export async function deleteSessionSummariesBySession(
  sessionKey: string,
  agentId?: string
): Promise<number> {
  const db = getDb()
  let query = db.deleteFrom('session_summaries').where('session_key', '=', sessionKey)

  if (agentId) {
    query = query.where('agent_id', '=', agentId)
  }

  const result = await query.executeTakeFirst()
  return Number(result.numDeletedRows ?? 0)
}
