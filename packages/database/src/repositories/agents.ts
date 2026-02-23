import { getDb } from '../db'
import type { Agent, NewAgent, AgentUpdate } from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

export async function findAgentById(id: string): Promise<Agent | null> {
  const db = getDb()
  const result = await db.selectFrom('agents').selectAll().where('id', '=', id).executeTakeFirst()
  return result ?? null
}

export async function findAgentByHandle(handle: string): Promise<Agent | null> {
  const db = getDb()
  const result = await db
    .selectFrom('agents')
    .selectAll()
    .where('handle', '=', handle)
    .executeTakeFirst()
  return result ?? null
}

/** @deprecated Use findAgentByHandle instead */
export async function findAgentByName(name: string): Promise<Agent | null> {
  // For backwards compatibility, search by handle (which was previously name)
  return findAgentByHandle(name)
}

export async function listAgents(): Promise<Agent[]> {
  const db = getDb()
  return db.selectFrom('agents').selectAll().execute()
}

/** Return the set of agent IDs that currently have RUNNING or PENDING jobs. */
export async function getAgentIdsWithActiveJobs(): Promise<Set<string>> {
  const db = getDb()
  const rows = await db
    .selectFrom('jobs')
    .select('agent_id')
    .where('status', 'in', ['RUNNING', 'PENDING'])
    .groupBy('agent_id')
    .execute()
  return new Set(rows.map((r) => r.agent_id))
}

export async function createAgent(
  data: Omit<NewAgent, 'id' | 'created_at' | 'updated_at'>
): Promise<Agent> {
  const db = getDb()
  const id = uuid()
  const timestamp = now()

  const result = await db
    .insertInto('agents')
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

export async function updateAgent(
  id: string,
  data: Omit<AgentUpdate, 'id' | 'created_at'>
): Promise<Agent | null> {
  const db = getDb()
  const result = await db
    .updateTable('agents')
    .set({ ...data, updated_at: now() })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}

export async function deleteAgent(id: string): Promise<boolean> {
  const db = getDb()
  const result = await db.deleteFrom('agents').where('id', '=', id).executeTakeFirst()
  return (result.numDeletedRows ?? 0n) > 0n
}
