import { getDb } from '../db'
import type { AgentMessage, NewAgentMessage } from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

export async function createAgentMessage(
  data: Omit<NewAgentMessage, 'id' | 'created_at'>
): Promise<AgentMessage> {
  const db = getDb()
  const id = uuid()

  const result = await db
    .insertInto('agent_messages')
    .values({
      id,
      ...data,
      created_at: now(),
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return result
}

export async function getUndeliveredMessagesForAgent(agentId: string): Promise<AgentMessage[]> {
  const db = getDb()
  return db
    .selectFrom('agent_messages')
    .selectAll()
    .where('to_agent_id', '=', agentId)
    .where('delivered', '=', 0)
    .orderBy('created_at', 'asc')
    .execute()
}

export async function markMessagesAsDelivered(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return
  const db = getDb()
  await db
    .updateTable('agent_messages')
    .set({ delivered: 1 })
    .where('id', 'in', messageIds)
    .execute()
}
