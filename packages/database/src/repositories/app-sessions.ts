import { getDb } from '../db'
import type {
  Agent,
  AppSession,
  AppSessionParticipant,
  NewAppSession,
  NewAppSessionParticipant,
} from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

export async function findAppSessionByKey(sessionKey: string): Promise<AppSession | null> {
  const db = getDb()
  const row = await db
    .selectFrom('app_sessions')
    .selectAll()
    .where('session_key', '=', sessionKey)
    .executeTakeFirst()
  return row ?? null
}

export async function findAppSessionByKeyAndOwner(
  sessionKey: string,
  ownerUserId: string
): Promise<AppSession | null> {
  const db = getDb()
  const row = await db
    .selectFrom('app_sessions')
    .selectAll()
    .where('session_key', '=', sessionKey)
    .where('owner_user_id', '=', ownerUserId)
    .executeTakeFirst()
  return row ?? null
}

export async function createAppSession(
  data: Omit<NewAppSession, 'created_at' | 'updated_at' | 'last_activity_at'>
): Promise<AppSession> {
  const db = getDb()
  const timestamp = now()
  return db
    .insertInto('app_sessions')
    .values({
      ...data,
      created_at: timestamp,
      updated_at: timestamp,
      last_activity_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function touchAppSessionLastActivity(sessionKey: string): Promise<AppSession | null> {
  const db = getDb()
  const timestamp = now()
  const row = await db
    .updateTable('app_sessions')
    .set({
      last_activity_at: timestamp,
      updated_at: timestamp,
    })
    .where('session_key', '=', sessionKey)
    .returningAll()
    .executeTakeFirst()
  return row ?? null
}

export async function listAppSessionsByOwner(
  ownerUserId: string,
  opts?: { limit?: number }
): Promise<AppSession[]> {
  const db = getDb()
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100)
  return db
    .selectFrom('app_sessions')
    .selectAll()
    .where('owner_user_id', '=', ownerUserId)
    .orderBy('last_activity_at', 'desc')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute()
}

export async function listAppSessionParticipants(
  sessionKey: string
): Promise<AppSessionParticipant[]> {
  const db = getDb()
  return db
    .selectFrom('app_session_participants')
    .selectAll()
    .where('session_key', '=', sessionKey)
    .orderBy('added_at', 'asc')
    .execute()
}

export async function addAppSessionParticipants(input: {
  sessionKey: string
  agentIds: string[]
  addedByUserId: string
}): Promise<void> {
  if (input.agentIds.length === 0) return

  const db = getDb()
  const timestamp = now()
  const values: NewAppSessionParticipant[] = input.agentIds.map((agentId) => ({
    session_key: input.sessionKey,
    agent_id: agentId,
    added_by_user_id: input.addedByUserId,
    added_at: timestamp,
  }))

  await db
    .insertInto('app_session_participants')
    .values(values)
    .onConflict((oc) => oc.columns(['session_key', 'agent_id']).doNothing())
    .execute()
}

export interface AppSessionParticipantAgent extends Agent {
  added_at: number
  added_by_user_id: string
}

export async function listAppSessionParticipantAgents(
  sessionKey: string
): Promise<AppSessionParticipantAgent[]> {
  const db = getDb()
  return db
    .selectFrom('app_session_participants')
    .innerJoin('agents', 'agents.id', 'app_session_participants.agent_id')
    .select([
      'agents.id',
      'agents.handle',
      'agents.name',
      'agents.sprite_id',
      'agents.config',
      'agents.status',
      'agents.created_at',
      'agents.updated_at',
      'app_session_participants.added_at',
      'app_session_participants.added_by_user_id',
    ])
    .where('app_session_participants.session_key', '=', sessionKey)
    .orderBy('app_session_participants.added_at', 'asc')
    .execute()
}
