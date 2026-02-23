import { sql } from 'kysely'
import { getDb } from '../db'
import type { Message, NewMessage, WorkItem } from '../types'
import { deserializeEmbedding, cosineSimilarity } from './memories'

// Re-export embedding helpers for convenience
export { deserializeEmbedding, serializeEmbedding } from './memories'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

/**
 * Message with associated work item context
 */
export interface SessionMessage extends Message {
  workItemTitle: string
  workItemCreatedAt: number
  jobCreatedAt: number
  agentId: string
  agentHandle: string
  agentName: string
  /** True when the job has a post-processed final_response (final-mode jobs) */
  jobHasFinalResponse: boolean
}

/**
 * Message with similarity score for search results
 */
export interface MessageSearchResult extends Message {
  similarity: number
  sessionKey: string
  agentId: string
}

export async function findMessageById(id: string): Promise<Message | null> {
  const db = getDb()
  const result = await db.selectFrom('messages').selectAll().where('id', '=', id).executeTakeFirst()
  return result ?? null
}

export async function listMessagesByJob(jobId: string): Promise<Message[]> {
  const db = getDb()
  const query = db
    .selectFrom('messages')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('created_at', 'asc')

  return query.execute()
}

export async function countMessagesByJob(jobId: string): Promise<number> {
  const db = getDb()
  const result = await db
    .selectFrom('messages')
    .select((eb) => eb.fn.count<string>('id').as('count'))
    .where('job_id', '=', jobId)
    .executeTakeFirst()
  return Number(result?.count ?? 0)
}

export async function listMessagesByJobPaged(
  jobId: string,
  options?: { offset?: number; limit?: number }
): Promise<Message[]> {
  const db = getDb()
  const offset = Math.max(0, options?.offset ?? 0)
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 500)
  return db
    .selectFrom('messages')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('created_at', 'asc')
    .offset(offset)
    .limit(limit)
    .execute()
}

export async function createMessage(data: Omit<NewMessage, 'id' | 'created_at'>): Promise<Message> {
  const db = getDb()
  const id = uuid()
  const timestamp = now()

  const result = await db
    .insertInto('messages')
    .values({
      id,
      ...data,
      created_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return result
}

export async function appendMessage(
  jobId: string,
  role: string,
  content: unknown
): Promise<Message> {
  return createMessage({
    job_id: jobId,
    role,
    content: content != null ? JSON.stringify(content) : null,
  })
}

/**
 * List all work items with a given session key
 */
export async function listWorkItemsBySession(
  sessionKey: string,
  options?: {
    limit?: number
    afterTimestamp?: number
  }
): Promise<WorkItem[]> {
  const db = getDb()
  let query = db
    .selectFrom('work_items')
    .selectAll()
    .where('session_key', '=', sessionKey)
    .orderBy('created_at', 'asc')

  if (options?.afterTimestamp != null) {
    query = query.where('created_at', '>', options.afterTimestamp)
  }

  if (options?.limit != null) {
    query = query.limit(options.limit)
  }

  return query.execute()
}

/**
 * Get messages from all jobs in a session
 *
 * Retrieves messages by traversing: session_key → work_items → jobs → messages
 * Returns messages ordered chronologically across all jobs in the session.
 */
export async function listMessagesBySession(
  sessionKey: string,
  options?: {
    limit?: number
    excludeJobId?: string
    excludeJobIds?: string[]
    completedOnly?: boolean
    afterTimestamp?: number
    completedBeforeTimestamp?: number
    agentId?: string
  }
): Promise<SessionMessage[]> {
  const db = getDb()

  // Build the query with JOINs
  let query = db
    .selectFrom('messages')
    .innerJoin('jobs', 'jobs.id', 'messages.job_id')
    .innerJoin('work_items', 'work_items.id', 'jobs.work_item_id')
    .innerJoin('agents', 'agents.id', 'jobs.agent_id')
    .select([
      'messages.id',
      'messages.job_id',
      'messages.role',
      'messages.content',
      'messages.embedding',
      'messages.created_at',
      'work_items.title as workItemTitle',
      'work_items.created_at as workItemCreatedAt',
      'jobs.created_at as jobCreatedAt',
      'jobs.agent_id as agentId',
      'agents.handle as agentHandle',
      'agents.name as agentName',
      sql<number>`(jobs.final_response IS NOT NULL)`.as('jobHasFinalResponse'),
    ])
    .where('work_items.session_key', '=', sessionKey)

  // Filter by agent if specified
  if (options?.agentId) {
    query = query.where('jobs.agent_id', '=', options.agentId)
  }

  // Filter by completed jobs only (default behavior for history)
  if (options?.completedOnly !== false) {
    query = query.where('jobs.status', '=', 'COMPLETED')
  }

  // Reconstruct history as-of a timestamp (based on job completion time)
  if (options?.completedBeforeTimestamp != null) {
    query = query.where('jobs.completed_at', '<=', options.completedBeforeTimestamp)
  }

  // Exclude current job (don't include messages from the in-progress job)
  if (options?.excludeJobId) {
    query = query.where('messages.job_id', '!=', options.excludeJobId)
  }

  // Exclude multiple job IDs (e.g. sibling jobs from same work item)
  if (options?.excludeJobIds && options.excludeJobIds.length > 0) {
    query = query.where('messages.job_id', 'not in', options.excludeJobIds)
  }

  // Filter by timestamp (for daily reset cutoff)
  if (options?.afterTimestamp != null) {
    query = query.where('jobs.created_at', '>', options.afterTimestamp)
  }

  // Order by job creation time, then message creation time
  query = query.orderBy('jobs.created_at', 'asc').orderBy('messages.created_at', 'asc')

  // Apply limit if specified
  if (options?.limit != null) {
    query = query.limit(options.limit)
  }

  const results = await query.execute()

  // Map to SessionMessage type
  return results.map((row) => ({
    id: row.id,
    job_id: row.job_id,
    role: row.role,
    content: row.content,
    embedding: row.embedding,
    created_at: row.created_at,
    workItemTitle: row.workItemTitle,
    workItemCreatedAt: row.workItemCreatedAt,
    jobCreatedAt: row.jobCreatedAt,
    agentId: row.agentId,
    agentHandle: row.agentHandle,
    agentName: row.agentName,
    jobHasFinalResponse: Boolean(row.jobHasFinalResponse),
  }))
}

/**
 * Get the timestamp of the most recent message in a session
 */
export async function getLastSessionMessageTime(
  sessionKey: string,
  agentId?: string
): Promise<number | null> {
  const db = getDb()

  let query = db
    .selectFrom('messages')
    .innerJoin('jobs', 'jobs.id', 'messages.job_id')
    .innerJoin('work_items', 'work_items.id', 'jobs.work_item_id')
    .select('messages.created_at')
    .where('work_items.session_key', '=', sessionKey)
    .where('jobs.status', '=', 'COMPLETED')

  if (agentId) {
    query = query.where('jobs.agent_id', '=', agentId)
  }

  const result = await query.orderBy('messages.created_at', 'desc').limit(1).executeTakeFirst()

  return result?.created_at ?? null
}

/**
 * Update a message's embedding
 */
export async function updateMessageEmbedding(
  messageId: string,
  embedding: Uint8Array
): Promise<void> {
  const db = getDb()
  await db.updateTable('messages').set({ embedding }).where('id', '=', messageId).execute()
}

/**
 * Get messages without embeddings (for batch processing)
 */
export async function listMessagesWithoutEmbeddings(limit: number = 100): Promise<Message[]> {
  const db = getDb()
  return db
    .selectFrom('messages')
    .selectAll()
    .where('embedding', 'is', null)
    .where('role', 'in', ['user', 'assistant'])
    .orderBy('created_at', 'asc')
    .limit(limit)
    .execute()
}

/**
 * Session info for compaction check
 */
export interface IdleSessionInfo {
  sessionKey: string
  agentId: string
  lastMessageTime: number
}

/**
 * Find sessions that have been idle longer than the threshold
 * Used to trigger session compaction and sprite cleanup
 */
export async function findIdleSessions(idleThresholdSeconds: number): Promise<IdleSessionInfo[]> {
  const db = getDb()
  const cutoff = Math.floor(Date.now() / 1000) - idleThresholdSeconds

  // Find distinct session_key + agent_id pairs with their last message time
  // Only include sessions with completed jobs and messages after cutoff
  const results = await db
    .selectFrom('messages')
    .innerJoin('jobs', 'jobs.id', 'messages.job_id')
    .innerJoin('work_items', 'work_items.id', 'jobs.work_item_id')
    .select([
      'work_items.session_key as sessionKey',
      'jobs.agent_id as agentId',
      (eb) => eb.fn.max('messages.created_at').as('lastMessageTime'),
    ])
    .where('jobs.status', '=', 'COMPLETED')
    .groupBy(['work_items.session_key', 'jobs.agent_id'])
    .execute()

  // Filter to only include sessions that are idle (last message before cutoff)
  return results
    .filter((row) => {
      const lastTime = row.lastMessageTime
      return typeof lastTime === 'number' && lastTime < cutoff
    })
    .map((row) => ({
      sessionKey: row.sessionKey,
      agentId: row.agentId,
      lastMessageTime: row.lastMessageTime,
    }))
}

/**
 * Search messages by semantic similarity
 */
export async function searchMessages(
  agentId: string,
  queryEmbedding: number[],
  options?: {
    sessionKey?: string
    limit?: number
    minSimilarity?: number
  }
): Promise<MessageSearchResult[]> {
  const db = getDb()
  const limit = options?.limit ?? 20
  const minSimilarity = options?.minSimilarity ?? 0.5

  // Build query to get messages with embeddings for this agent
  let query = db
    .selectFrom('messages')
    .innerJoin('jobs', 'jobs.id', 'messages.job_id')
    .innerJoin('work_items', 'work_items.id', 'jobs.work_item_id')
    .select([
      'messages.id',
      'messages.job_id',
      'messages.role',
      'messages.content',
      'messages.embedding',
      'messages.created_at',
      'work_items.session_key as sessionKey',
      'jobs.agent_id as agentId',
    ])
    .where('jobs.agent_id', '=', agentId)
    .where('messages.embedding', 'is not', null)
    .where('jobs.status', '=', 'COMPLETED')

  // Filter by session if specified
  if (options?.sessionKey) {
    query = query.where('work_items.session_key', '=', options.sessionKey)
  }

  const results = await query.execute()

  // Calculate similarity for each message
  const scoredMessages = results
    .map((row) => {
      const embedding = deserializeEmbedding(row.embedding)
      if (!embedding) return null

      const similarity = cosineSimilarity(queryEmbedding, embedding)
      if (similarity < minSimilarity) return null

      return {
        id: row.id,
        job_id: row.job_id,
        role: row.role,
        content: row.content,
        embedding: row.embedding,
        created_at: row.created_at,
        similarity,
        sessionKey: row.sessionKey,
        agentId: row.agentId,
      } as MessageSearchResult
    })
    .filter((m): m is MessageSearchResult => m !== null)

  // Sort by similarity and return top N
  scoredMessages.sort((a, b) => b.similarity - a.similarity)
  return scoredMessages.slice(0, limit)
}

/**
 * Telegram session info returned by listTelegramSessionsForAgent
 */
export interface TelegramSessionInfo {
  sessionKey: string
  chatId: string | null
  threadId: string | null
  chatName: string | null
  lastMessagePreview: string | null
  lastSender: string | null
  lastMessageTime: number
}

/**
 * Parse a telegram session key into chatId and threadId.
 * Formats: "telegram:<chatId>" or "telegram:<chatId>:thread:<threadId>"
 */
function parseTelegramSessionKey(sessionKey: string): {
  chatId: string | null
  threadId: string | null
} {
  const withoutPrefix = sessionKey.replace(/^telegram:/, '')
  // Format: "chatId:thread:threadId" or just "chatId"
  const threadMarker = ':thread:'
  const threadIdx = withoutPrefix.indexOf(threadMarker)
  if (threadIdx >= 0) {
    return {
      chatId: withoutPrefix.slice(0, threadIdx) || null,
      threadId: withoutPrefix.slice(threadIdx + threadMarker.length) || null,
    }
  }
  return {
    chatId: withoutPrefix || null,
    threadId: null,
  }
}

/**
 * List distinct Telegram sessions an agent has participated in.
 * Returns session keys matching `telegram:*` with the most recent activity,
 * enriched with chat name, last message preview, and sender info.
 */
export async function listTelegramSessionsForAgent(
  agentId: string,
  options?: { limit?: number }
): Promise<TelegramSessionInfo[]> {
  const db = getDb()
  const limit = options?.limit ?? 20

  // Get distinct session keys with most recent work item info
  const results = await db
    .selectFrom('work_items')
    .innerJoin('jobs', 'jobs.work_item_id', 'work_items.id')
    .select([
      'work_items.session_key as sessionKey',
      (eb) => eb.fn.max('work_items.created_at').as('lastMessageTime'),
    ])
    .where('jobs.agent_id', '=', agentId)
    .where('work_items.session_key', 'like', 'telegram:%')
    .groupBy('work_items.session_key')
    .orderBy('lastMessageTime', 'desc')
    .limit(limit)
    .execute()

  // For each session, fetch the most recent work item to extract enrichment data
  const enriched: TelegramSessionInfo[] = []
  for (const row of results) {
    const { chatId, threadId } = parseTelegramSessionKey(row.sessionKey)

    // Get the most recent work item for this session to extract payload info
    const latestWorkItem = await db
      .selectFrom('work_items')
      .select(['title', 'payload'])
      .where('session_key', '=', row.sessionKey)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst()

    let chatName: string | null = null
    let lastMessagePreview: string | null = null
    let lastSender: string | null = null

    if (latestWorkItem?.payload) {
      try {
        const payload = JSON.parse(latestWorkItem.payload) as Record<string, unknown>
        chatName = typeof payload.chatName === 'string' ? payload.chatName : null
        lastSender = typeof payload.senderName === 'string' ? payload.senderName : null
        const body = typeof payload.body === 'string' ? payload.body : null
        if (body) {
          lastMessagePreview = body.length > 100 ? body.slice(0, 100) + '...' : body
        }
      } catch {
        // ignore parse errors
      }
    }

    // Fall back to work item title if no body preview
    if (!lastMessagePreview && latestWorkItem?.title) {
      lastMessagePreview = latestWorkItem.title
    }

    enriched.push({
      sessionKey: row.sessionKey,
      chatId,
      threadId,
      chatName,
      lastMessagePreview,
      lastSender,
      lastMessageTime: row.lastMessageTime,
    })
  }

  return enriched
}
