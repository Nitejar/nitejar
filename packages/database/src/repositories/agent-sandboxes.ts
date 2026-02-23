import { getDb } from '../db'
import type { AgentSandbox, AgentSandboxUpdate, NewAgentSandbox } from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

export async function findAgentSandboxById(id: string): Promise<AgentSandbox | null> {
  const db = getDb()
  const row = await db
    .selectFrom('agent_sandboxes')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return row ?? null
}

export async function listAgentSandboxes(agentId: string): Promise<AgentSandbox[]> {
  const db = getDb()
  return db
    .selectFrom('agent_sandboxes')
    .selectAll()
    .where('agent_id', '=', agentId)
    .orderBy('kind', 'asc')
    .orderBy('name', 'asc')
    .execute()
}

export async function findAgentSandboxByName(
  agentId: string,
  name: string
): Promise<AgentSandbox | null> {
  const db = getDb()
  const row = await db
    .selectFrom('agent_sandboxes')
    .selectAll()
    .where('agent_id', '=', agentId)
    .where('name', '=', name)
    .executeTakeFirst()
  return row ?? null
}

export async function findAgentSandboxBySpriteName(
  agentId: string,
  spriteName: string
): Promise<AgentSandbox | null> {
  const db = getDb()
  const row = await db
    .selectFrom('agent_sandboxes')
    .selectAll()
    .where('agent_id', '=', agentId)
    .where('sprite_name', '=', spriteName)
    .executeTakeFirst()
  return row ?? null
}

export async function createAgentSandbox(
  data: Omit<NewAgentSandbox, 'id' | 'created_at' | 'updated_at' | 'last_used_at'>
): Promise<AgentSandbox> {
  const db = getDb()
  const timestamp = now()
  return db
    .insertInto('agent_sandboxes')
    .values({
      id: uuid(),
      ...data,
      created_at: timestamp,
      updated_at: timestamp,
      last_used_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function updateAgentSandbox(
  id: string,
  data: Omit<AgentSandboxUpdate, 'id' | 'created_at'>
): Promise<AgentSandbox | null> {
  const db = getDb()
  const row = await db
    .updateTable('agent_sandboxes')
    .set({ ...data, updated_at: now() })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
  return row ?? null
}

export async function deleteAgentSandbox(id: string): Promise<boolean> {
  const db = getDb()
  const result = await db.deleteFrom('agent_sandboxes').where('id', '=', id).executeTakeFirst()
  return (result.numDeletedRows ?? 0n) > 0n
}

export async function touchAgentSandboxLastUsed(
  id: string,
  ts: number = now()
): Promise<AgentSandbox | null> {
  return updateAgentSandbox(id, { last_used_at: ts })
}
