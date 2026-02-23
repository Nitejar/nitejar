import { getDb } from '../db'
import type { SpriteSession, NewSpriteSession, SpriteSessionUpdate } from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

/**
 * Find a sprite session by its ID
 */
export async function findSpriteSessionById(id: string): Promise<SpriteSession | null> {
  const db = getDb()
  const result = await db
    .selectFrom('sprite_sessions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return result ?? null
}

/**
 * Find an active sprite session for a conversation (session_key + agent_id)
 */
export async function findSpriteSessionBySessionKey(
  sessionKey: string,
  agentId: string,
  spriteName?: string
): Promise<SpriteSession | null> {
  const db = getDb()
  let query = db
    .selectFrom('sprite_sessions')
    .selectAll()
    .where('session_key', '=', sessionKey)
    .where('agent_id', '=', agentId)
    .where('status', '=', 'active')
  if (spriteName) {
    query = query.where('sprite_name', '=', spriteName)
  }
  const result = await query.executeTakeFirst()
  return result ?? null
}

/**
 * Find a sprite session by its Sprites API session ID
 */
export async function findSpriteSessionBySessionId(
  sessionId: string
): Promise<SpriteSession | null> {
  const db = getDb()
  const result = await db
    .selectFrom('sprite_sessions')
    .selectAll()
    .where('session_id', '=', sessionId)
    .executeTakeFirst()
  return result ?? null
}

/**
 * Create a new sprite session record
 */
export async function createSpriteSession(
  data: Omit<NewSpriteSession, 'id' | 'created_at' | 'last_active_at'>
): Promise<SpriteSession> {
  const db = getDb()
  const id = uuid()
  const timestamp = now()

  const result = await db
    .insertInto('sprite_sessions')
    .values({
      id,
      ...data,
      created_at: timestamp,
      last_active_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return result
}

/**
 * Update a sprite session
 */
export async function updateSpriteSession(
  id: string,
  data: Omit<SpriteSessionUpdate, 'id' | 'created_at'>
): Promise<SpriteSession | null> {
  const db = getDb()
  const result = await db
    .updateTable('sprite_sessions')
    .set(data)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}

/**
 * Update the last_active_at timestamp for a session
 */
export async function touchSpriteSession(id: string): Promise<SpriteSession | null> {
  return updateSpriteSession(id, { last_active_at: now() })
}

/**
 * Mark a sprite session as closed
 */
export async function closeSpriteSession(id: string): Promise<SpriteSession | null> {
  return updateSpriteSession(id, { status: 'closed', last_active_at: now() })
}

/**
 * Mark a sprite session as errored
 */
export async function errorSpriteSession(id: string): Promise<SpriteSession | null> {
  return updateSpriteSession(id, { status: 'error', last_active_at: now() })
}

/**
 * Find all active sessions for a sprite
 */
export async function findActiveSpriteSessionsBySprite(
  spriteName: string
): Promise<SpriteSession[]> {
  const db = getDb()
  return db
    .selectFrom('sprite_sessions')
    .selectAll()
    .where('sprite_name', '=', spriteName)
    .where('status', '=', 'active')
    .orderBy('created_at', 'desc')
    .execute()
}

/**
 * Find stale sessions (active but not touched for longer than maxAgeSeconds)
 */
export async function findStaleSessions(maxAgeSeconds: number): Promise<SpriteSession[]> {
  const db = getDb()
  const cutoff = now() - maxAgeSeconds

  return db
    .selectFrom('sprite_sessions')
    .selectAll()
    .where('status', '=', 'active')
    .where('last_active_at', '<', cutoff)
    .execute()
}

/**
 * Close all active sessions for a conversation (session_key + agent_id)
 */
export async function closeSessionsForConversation(
  sessionKey: string,
  agentId: string
): Promise<number> {
  const db = getDb()
  const result = await db
    .updateTable('sprite_sessions')
    .set({ status: 'closed', last_active_at: now() })
    .where('session_key', '=', sessionKey)
    .where('agent_id', '=', agentId)
    .where('status', '=', 'active')
    .execute()

  return result.length > 0 ? Number(result[0]?.numUpdatedRows ?? 0) : 0
}

/**
 * Find all active sessions for a conversation (session_key + agent_id).
 */
export async function findActiveSessionsForConversation(
  sessionKey: string,
  agentId: string
): Promise<SpriteSession[]> {
  const db = getDb()
  return db
    .selectFrom('sprite_sessions')
    .selectAll()
    .where('session_key', '=', sessionKey)
    .where('agent_id', '=', agentId)
    .where('status', '=', 'active')
    .orderBy('created_at', 'desc')
    .execute()
}

/**
 * Delete old closed/errored sessions (cleanup)
 */
export async function deleteOldSessions(maxAgeSeconds: number): Promise<number> {
  const db = getDb()
  const cutoff = now() - maxAgeSeconds

  const result = await db
    .deleteFrom('sprite_sessions')
    .where('status', 'in', ['closed', 'error'])
    .where('last_active_at', '<', cutoff)
    .execute()

  return result.length > 0 ? Number(result[0]?.numDeletedRows ?? 0) : 0
}
