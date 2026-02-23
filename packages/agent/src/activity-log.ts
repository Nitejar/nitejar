import {
  appendActivityEntry,
  findByResources,
  findSimilarActivityEntries,
  updateActivityStatus,
  serializeEmbedding,
  type Agent,
  type Job,
  type WorkItem,
  type ActivityLogEntry,
} from '@nitejar/database'
import { generateEmbedding, isEmbeddingsAvailable } from './embeddings'
import { agentWarn } from './agent-logger'
import type { TriageResult } from './triage'

/**
 * Record that an agent is starting work.
 * Generates an embedding for the triage reason and appends to the activity log.
 * Returns the entry ID for later status transitions.
 */
export async function recordStartingActivity(
  agent: Agent,
  job: Job,
  workItem: WorkItem,
  triage: TriageResult
): Promise<string | null> {
  try {
    let embeddingBlob: Uint8Array | null = null
    if (isEmbeddingsAvailable() && triage.reason) {
      try {
        const vector = await generateEmbedding(triage.reason)
        embeddingBlob = serializeEmbedding(vector)
      } catch (error) {
        agentWarn('Failed to generate embedding for activity log entry', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const entry = await appendActivityEntry({
      agent_id: agent.id,
      agent_handle: agent.handle,
      job_id: job.id,
      session_key: workItem.session_key,
      status: 'starting',
      summary: triage.reason,
      resources: triage.resources.length > 0 ? JSON.stringify(triage.resources) : null,
      embedding: embeddingBlob,
    })

    return entry.id
  } catch (error) {
    agentWarn('Failed to record starting activity', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Record that an agent is passing on a work item (decided not to respond).
 * Similar to recordStartingActivity but with status 'passed'.
 */
export async function recordPassActivity(
  agent: Agent,
  job: Job,
  workItem: WorkItem,
  triage: TriageResult
): Promise<string | null> {
  try {
    let embeddingBlob: Uint8Array | null = null
    const reason = triage.reason || 'Decided not to respond'
    if (isEmbeddingsAvailable() && reason) {
      try {
        const vector = await generateEmbedding(reason)
        embeddingBlob = serializeEmbedding(vector)
      } catch (error) {
        agentWarn('Failed to generate embedding for pass activity log entry', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const entry = await appendActivityEntry({
      agent_id: agent.id,
      agent_handle: agent.handle,
      job_id: job.id,
      session_key: workItem.session_key,
      status: 'passed',
      summary: reason,
      resources: triage.resources.length > 0 ? JSON.stringify(triage.resources) : null,
      embedding: embeddingBlob,
    })

    return entry.id
  } catch (error) {
    agentWarn('Failed to record pass activity', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Mark an activity entry as completed.
 */
export async function recordCompletedActivity(activityId: string | null): Promise<void> {
  if (!activityId) return
  try {
    await updateActivityStatus(activityId, 'completed')
  } catch (error) {
    agentWarn('Failed to record completed activity', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Mark an activity entry as failed.
 */
export async function recordFailedActivity(activityId: string | null): Promise<void> {
  if (!activityId) return
  try {
    await updateActivityStatus(activityId, 'failed')
  } catch (error) {
    agentWarn('Failed to record failed activity', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Get relevant activity for prompt injection.
 * Two-pronged search:
 *   1. Exact match on resources — fast, finds entries working on same resources
 *   2. Semantic similarity on reason — catches related-but-different work
 * Merges, deduplicates, and formats for prompt injection.
 */
export async function getRelevantActivity(
  triage: TriageResult,
  limit: number = 10
): Promise<string | null> {
  try {
    const seen = new Set<string>()
    const results: Array<ActivityLogEntry & { similarity?: number }> = []

    // 1. Exact resource match
    if (triage.resources.length > 0) {
      const resourceMatches = await findByResources(triage.resources)
      for (const entry of resourceMatches) {
        if (!seen.has(entry.id)) {
          seen.add(entry.id)
          results.push(entry)
        }
      }
    }

    // 2. Semantic similarity
    if (triage.reason && isEmbeddingsAvailable()) {
      try {
        const queryVector = await generateEmbedding(triage.reason)
        const similarEntries = await findSimilarActivityEntries(queryVector, 3600, limit)
        for (const entry of similarEntries) {
          if (!seen.has(entry.id) && entry.similarity > 0.3) {
            seen.add(entry.id)
            results.push(entry)
          }
        }
      } catch {
        // Embedding search failed — proceed with resource matches only
      }
    }

    if (results.length === 0) return null

    // Format for prompt injection
    const now = Math.floor(Date.now() / 1000)
    const lines = results.slice(0, limit).map((entry) => {
      const age = formatAge(now - entry.created_at)
      const resources = entry.resources ? ` Ref: ${parseResourcesSafe(entry.resources)}` : ''
      return `- [${age}] agent:${entry.agent_handle} — ${entry.status}: ${entry.summary}${resources}`
    })

    return lines.join('\n')
  } catch (error) {
    agentWarn('Failed to get relevant activity', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}min ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

function parseResourcesSafe(resourcesJson: string): string {
  try {
    const arr = JSON.parse(resourcesJson) as string[]
    return arr.join(', ')
  } catch {
    return resourcesJson
  }
}
