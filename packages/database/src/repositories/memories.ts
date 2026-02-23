import { getDb } from '../db'
import type { AgentMemory, NewAgentMemory, AgentMemoryUpdate } from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

// Seconds in a week for decay calculations
const SECONDS_PER_WEEK = 7 * 24 * 60 * 60

export async function findMemoryById(id: string): Promise<AgentMemory | null> {
  const db = getDb()
  const result = await db
    .selectFrom('agent_memories')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return result ?? null
}

export async function listMemories(
  agentId: string,
  minStrength: number = 0
): Promise<AgentMemory[]> {
  const db = getDb()
  return db
    .selectFrom('agent_memories')
    .selectAll()
    .where('agent_id', '=', agentId)
    .where('strength', '>=', minStrength)
    .orderBy('strength', 'desc')
    .execute()
}

export async function listPermanentMemories(agentId: string): Promise<AgentMemory[]> {
  const db = getDb()
  return db
    .selectFrom('agent_memories')
    .selectAll()
    .where('agent_id', '=', agentId)
    .where('permanent', '=', 1)
    .execute()
}

export async function createMemory(
  data: Omit<NewAgentMemory, 'id' | 'created_at' | 'updated_at'>
): Promise<AgentMemory> {
  const db = getDb()
  const id = uuid()
  const timestamp = now()

  const result = await db
    .insertInto('agent_memories')
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

export async function updateMemory(
  id: string,
  data: Omit<AgentMemoryUpdate, 'id' | 'created_at'>,
  expectedVersion?: number
): Promise<AgentMemory | null> {
  const db = getDb()

  let query = db.updateTable('agent_memories').where('id', '=', id)

  if (expectedVersion !== undefined) {
    // Optimistic concurrency: only update if version matches, then bump version
    query = query.where('version', '=', expectedVersion)
    const result = await query
      .set({ ...data, updated_at: now(), version: expectedVersion + 1 })
      .returningAll()
      .executeTakeFirst()
    // null means version mismatch (0 rows affected)
    return result ?? null
  }

  const result = await query
    .set({ ...data, updated_at: now() })
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}

export async function deleteMemory(id: string): Promise<boolean> {
  const db = getDb()
  const result = await db.deleteFrom('agent_memories').where('id', '=', id).executeTakeFirst()
  return (result.numDeletedRows ?? 0n) > 0n
}

/**
 * Delete all non-permanent memories for an agent
 * Used when clearing session memories on reset
 */
export async function deleteNonPermanentMemoriesByAgent(agentId: string): Promise<number> {
  const db = getDb()
  const result = await db
    .deleteFrom('agent_memories')
    .where('agent_id', '=', agentId)
    .where('permanent', '=', 0)
    .executeTakeFirst()
  return Number(result.numDeletedRows ?? 0)
}

/**
 * Reinforce a memory when it's accessed - boosts strength and increments access count
 */
export async function reinforceMemory(
  id: string,
  reinforceAmount: number = 0.2
): Promise<AgentMemory | null> {
  const db = getDb()
  const memory = await findMemoryById(id)
  if (!memory) return null

  const newStrength = Math.min(1.0, memory.strength + reinforceAmount)
  const result = await db
    .updateTable('agent_memories')
    .set({
      strength: newStrength,
      access_count: memory.access_count + 1,
      last_accessed_at: now(),
      updated_at: now(),
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()

  return result ?? null
}

/**
 * Decay all non-permanent memories for an agent
 * @param agentId - The agent whose memories to decay
 * @param decayRatePerWeek - How much strength to lose per week of non-access (default 0.1)
 */
export async function decayMemories(
  agentId: string,
  decayRatePerWeek: number = 0.1
): Promise<number> {
  const db = getDb()
  const currentTime = now()

  // Get all non-permanent memories for this agent
  const memories = await db
    .selectFrom('agent_memories')
    .selectAll()
    .where('agent_id', '=', agentId)
    .where('permanent', '=', 0)
    .execute()

  let decayedCount = 0

  for (const memory of memories) {
    // Calculate time since last access (or creation if never accessed)
    const lastAccess = memory.last_accessed_at ?? memory.created_at
    const secondsSinceAccess = currentTime - lastAccess
    const weeksSinceAccess = secondsSinceAccess / SECONDS_PER_WEEK

    // Calculate decay based on time since last access
    const decay = weeksSinceAccess * decayRatePerWeek
    const newStrength = Math.max(0, memory.strength - decay)

    // Only update if there's meaningful decay
    if (Math.abs(newStrength - memory.strength) > 0.001) {
      await db
        .updateTable('agent_memories')
        .set({
          strength: newStrength,
          updated_at: currentTime,
        })
        .where('id', '=', memory.id)
        .execute()
      decayedCount++
    }
  }

  return decayedCount
}

/**
 * Toggle the permanent status of a memory
 */
export async function toggleMemoryPermanent(id: string): Promise<AgentMemory | null> {
  const memory = await findMemoryById(id)
  if (!memory) return null

  const newPermanent = memory.permanent === 1 ? 0 : 1
  const updates: AgentMemoryUpdate = {
    permanent: newPermanent,
    updated_at: now(),
  }

  // If making permanent, also restore strength to 1.0
  if (newPermanent === 1) {
    updates.strength = 1.0
  }

  const db = getDb()
  const result = await db
    .updateTable('agent_memories')
    .set(updates)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()

  return result ?? null
}

/**
 * Find memories similar to a query embedding using cosine similarity
 * This is done in application code for SQLite compatibility
 * For production with Postgres, this would use pgvector
 */
export async function findSimilarMemories(
  agentId: string,
  queryEmbedding: number[],
  limit: number = 15,
  minStrength: number = 0.1
): Promise<Array<AgentMemory & { similarity: number }>> {
  const db = getDb()

  // Get all memories with embeddings above the strength threshold
  const memories = await db
    .selectFrom('agent_memories')
    .selectAll()
    .where('agent_id', '=', agentId)
    .where('strength', '>=', minStrength)
    .where('embedding', 'is not', null)
    .execute()

  // Calculate cosine similarity for each memory
  const scoredMemories = memories
    .map((memory) => {
      const embedding = deserializeEmbedding(memory.embedding)
      if (!embedding) return null

      const similarity = cosineSimilarity(queryEmbedding, embedding)
      return { ...memory, similarity }
    })
    .filter((m): m is AgentMemory & { similarity: number } => m !== null)

  // Sort by similarity and return top N
  scoredMemories.sort((a, b) => b.similarity - a.similarity)
  return scoredMemories.slice(0, limit)
}

/**
 * Serialize a number array to a Uint8Array for storage as BLOB
 */
export function serializeEmbedding(embedding: number[]): Uint8Array {
  const buffer = new Float32Array(embedding)
  return new Uint8Array(buffer.buffer)
}

/**
 * Deserialize a BLOB back to a number array
 */
export function deserializeEmbedding(blob: Uint8Array | null): number[] | null {
  if (!blob) return null
  const buffer = new Float32Array(blob.buffer, blob.byteOffset, blob.length / 4)
  return Array.from(buffer)
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i]!
    const bVal = b[i]!
    dotProduct += aVal * bVal
    normA += aVal * aVal
    normB += bVal * bVal
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  if (magnitude === 0) return 0

  return dotProduct / magnitude
}
