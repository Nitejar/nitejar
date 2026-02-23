import {
  listMemories,
  reinforceMemory as dbReinforceMemory,
  decayMemories as dbDecayMemories,
  findSimilarMemories,
  createMemory as dbCreateMemory,
  updateMemory as dbUpdateMemory,
  serializeEmbedding,
  cosineSimilarity,
  deserializeEmbedding,
  type AgentMemory,
} from '@nitejar/database'
import { generateEmbedding, isEmbeddingsAvailable } from './embeddings'
import { getMemorySettings } from './config'
import type { AgentConfig, MemorySettings, ScoredMemory } from './types'
import { sanitize, wrapBoundary } from './prompt-sanitize'

// Seconds in a day for recency calculations
const SECONDS_PER_DAY = 24 * 60 * 60

/**
 * Retrieve relevant memories for an agent given the current context
 * Uses multi-factor scoring: similarity, strength, access count, recency
 */
export async function retrieveMemories(
  agentId: string,
  contextText: string,
  config: AgentConfig
): Promise<ScoredMemory[]> {
  const settings = getMemorySettings(config)

  // Skip if memory is disabled
  if (settings.enabled === false) {
    return []
  }

  // Apply decay to non-permanent memories first
  await dbDecayMemories(agentId, settings.decayRate)

  // Get all memories above strength threshold
  const memories = await listMemories(agentId, settings.minStrength)
  if (memories.length === 0) {
    return []
  }

  // Generate query embedding if embeddings are available
  let queryEmbedding: number[] | null = null
  if (isEmbeddingsAvailable()) {
    try {
      queryEmbedding = await generateEmbedding(contextText)
    } catch (error) {
      console.warn('[Memory] Failed to generate query embedding:', error)
    }
  }

  // Score each memory
  const scoredMemories = memories.map((memory) => scoreMemory(memory, queryEmbedding, settings))

  // Sort by score descending and take top N
  scoredMemories.sort((a, b) => b.score - a.score)
  const topMemories = scoredMemories.slice(0, settings.maxMemories)

  // Reinforce accessed memories
  for (const memory of topMemories) {
    await dbReinforceMemory(memory.id, settings.reinforceAmount)
  }

  return topMemories
}

/**
 * Score a memory based on multiple factors
 */
function scoreMemory(
  memory: AgentMemory,
  queryEmbedding: number[] | null,
  settings: Required<MemorySettings>
): ScoredMemory {
  let score = 0
  let similarity: number | undefined

  // Factor 1: Similarity (0-1 from cosine similarity) - weighted by similarityWeight
  if (queryEmbedding && memory.embedding) {
    const memoryEmbedding = deserializeEmbedding(memory.embedding)
    if (memoryEmbedding) {
      similarity = cosineSimilarity(queryEmbedding, memoryEmbedding)
      score += similarity * 50 * settings.similarityWeight
    }
  }

  // Factor 2: Strength (0-1) - memories with higher strength are more relevant
  score += memory.strength * 30

  // Factor 3: Access frequency - frequently accessed = more relevant
  // Cap contribution at 20 points
  score += Math.min(memory.access_count * 2, 20)

  // Factor 4: Recency bonus - recently accessed memories get a boost
  const now = Math.floor(Date.now() / 1000)
  const lastAccess = memory.last_accessed_at ?? memory.created_at
  const daysSinceAccess = (now - lastAccess) / SECONDS_PER_DAY

  if (daysSinceAccess < 1) {
    score += 10 // Accessed today
  } else if (daysSinceAccess < 7) {
    score += 5 // Accessed this week
  }

  return {
    id: memory.id,
    agentId: memory.agent_id,
    content: memory.content,
    strength: memory.strength,
    accessCount: memory.access_count,
    permanent: memory.permanent === 1,
    version: memory.version,
    lastAccessedAt: memory.last_accessed_at,
    createdAt: memory.created_at,
    updatedAt: memory.updated_at,
    score,
    similarity,
  }
}

/**
 * Create a new memory with embedding
 */
export async function createMemoryWithEmbedding(
  agentId: string,
  content: string,
  permanent: boolean = false
): Promise<AgentMemory> {
  let embedding: Uint8Array | null = null

  // Generate embedding if available
  if (isEmbeddingsAvailable()) {
    try {
      const embeddingVector = await generateEmbedding(content)
      embedding = serializeEmbedding(embeddingVector)
    } catch (error) {
      console.warn('[Memory] Failed to generate embedding for new memory:', error)
    }
  }

  return dbCreateMemory({
    agent_id: agentId,
    content,
    embedding,
    permanent: permanent ? 1 : 0,
    strength: 1.0,
    access_count: 0,
    last_accessed_at: null,
  })
}

/**
 * Update a memory's content and regenerate its embedding.
 * Optionally accepts expectedVersion for optimistic concurrency control.
 */
export async function updateMemoryWithEmbedding(
  id: string,
  content: string,
  expectedVersion?: number
): Promise<AgentMemory | null> {
  let embedding: Uint8Array | null = null

  // Generate new embedding if available
  if (isEmbeddingsAvailable()) {
    try {
      const embeddingVector = await generateEmbedding(content)
      embedding = serializeEmbedding(embeddingVector)
    } catch (error) {
      console.warn('[Memory] Failed to generate embedding for updated memory:', error)
    }
  }

  return dbUpdateMemory(
    id,
    {
      content,
      embedding,
    },
    expectedVersion
  )
}

/**
 * Format memories for inclusion in system prompt.
 * Includes version and id so agents can reference them for updates.
 * Memory content is sanitized and wrapped in a <memory> boundary.
 */
export function formatMemoriesForPrompt(memories: ScoredMemory[]): string {
  if (memories.length === 0) {
    return ''
  }

  const memoryLines = memories.map((m) => {
    const marker = m.permanent ? '📌 ' : ''
    const versionTag = m.version !== undefined ? `[v${m.version}] ` : ''
    return `- ${marker}${versionTag}${sanitize(m.content)} (id: ${m.id})`
  })

  return wrapBoundary('memory', `## Things You Remember\n${memoryLines.join('\n')}`)
}

/**
 * Find memories similar to a query text
 * Useful for deduplication or finding related memories
 */
export async function findRelatedMemories(
  agentId: string,
  queryText: string,
  limit: number = 5
): Promise<Array<AgentMemory & { similarity: number }>> {
  if (!isEmbeddingsAvailable()) {
    return []
  }

  try {
    const queryEmbedding = await generateEmbedding(queryText)
    return findSimilarMemories(agentId, queryEmbedding, limit)
  } catch (error) {
    console.warn('[Memory] Failed to find related memories:', error)
    return []
  }
}
