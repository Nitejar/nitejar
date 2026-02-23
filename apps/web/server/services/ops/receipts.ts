import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  countPassiveMemoryQueueByWorkItem,
  countQueueMessagesByWorkItem,
  findActivityEntriesByJobIds,
  findMessageById,
  findRunDispatchById,
  findWorkItemById,
  listPassiveMemoryQueueByWorkItem,
  listJobsByWorkItem,
  listQueueMessagesByWorkItem,
  listRunDispatchesByWorkItem,
} from '@nitejar/database'
import type {
  GetDispatchDecisionsInput,
  GetMessageChunkInput,
  GetWorkItemQueueMessagesInput,
  GetWorkItemTriageReceiptsInput,
} from '@/server/services/ops/schemas'
import { buildPageInfo, getUtf8Chunk, normalizeOffset } from './chunking'

type ParsedDispatchDecision = {
  kind: 'arbiter' | 'control'
  decision: string | null
  reason: string | null
}

function parseDispatchDecision(controlReason: string | null): ParsedDispatchDecision {
  if (!controlReason) {
    return { kind: 'control', decision: null, reason: null }
  }
  if (!controlReason.startsWith('arbiter:')) {
    return { kind: 'control', decision: null, reason: controlReason }
  }

  const [, decision, ...reasonParts] = controlReason.split(':')
  return {
    kind: 'arbiter',
    decision: decision ?? null,
    reason: reasonParts.join(':').trim() || null,
  }
}

type TriageLogEntry = {
  timestamp?: unknown
  agentId?: unknown
  agentHandle?: unknown
  workItemId?: unknown
  sessionKey?: unknown
  source?: unknown
  model?: unknown
  rawResponse?: unknown
  result?: {
    isReadOnly?: unknown
    shouldRespond?: unknown
    exclusiveClaim?: unknown
    reason?: unknown
    reasonAutoDerived?: unknown
    resources?: unknown
  }
  usage?: {
    promptTokens?: unknown
    completionTokens?: unknown
    totalTokens?: unknown
    costUsd?: unknown
    durationMs?: unknown
  } | null
}

const TRIAGE_LOG_RELATIVE_PATH = path.join('logs', 'triage.jsonl')
const TRIAGE_LOG_SEARCH_UP_LEVELS = 6

async function resolveTriageLogPath(): Promise<string | null> {
  let currentDir = process.cwd()

  for (let depth = 0; depth <= TRIAGE_LOG_SEARCH_UP_LEVELS; depth++) {
    const candidate = path.resolve(currentDir, TRIAGE_LOG_RELATIVE_PATH)
    try {
      await access(candidate)
      return candidate
    } catch {
      // Continue searching parent directories.
    }

    const parent = path.dirname(currentDir)
    if (parent === currentDir) break
    currentDir = parent
  }

  return null
}

async function readTriageLogEntriesForWorkItem(workItemId: string): Promise<TriageLogEntry[]> {
  const triagePath = await resolveTriageLogPath()
  if (!triagePath) return []
  let contents: string
  try {
    contents = await readFile(triagePath, 'utf8')
  } catch {
    return []
  }

  const entries: TriageLogEntry[] = []
  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.includes(workItemId)) continue
    try {
      const parsed = JSON.parse(trimmed) as TriageLogEntry
      if (parsed.workItemId === workItemId) {
        entries.push(parsed)
      }
    } catch {
      // Ignore malformed lines to keep receipts robust.
    }
  }

  return entries.sort((a, b) => {
    const aTs = typeof a.timestamp === 'string' ? Date.parse(a.timestamp) : 0
    const bTs = typeof b.timestamp === 'string' ? Date.parse(b.timestamp) : 0
    return aTs - bTs
  })
}

export async function getWorkItemQueueMessagesOp(input: GetWorkItemQueueMessagesInput) {
  const workItem = await findWorkItemById(input.workItemId)
  if (!workItem) throw new Error('Work item not found')

  const offset = normalizeOffset(input.offset)
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500)

  const [total, queueMessages] = await Promise.all([
    countQueueMessagesByWorkItem(workItem.id),
    listQueueMessagesByWorkItem(workItem.id, {
      offset,
      limit,
      statuses: input.statuses,
    }),
  ])

  return {
    workItemId: workItem.id,
    queueMessages,
    page: buildPageInfo({
      offset,
      limit,
      returned: queueMessages.length,
      total,
    }),
  }
}

export async function getDispatchDecisionsOp(input: GetDispatchDecisionsInput) {
  const rows = input.dispatchId
    ? [await findRunDispatchById(input.dispatchId)]
    : await listRunDispatchesByWorkItem(input.workItemId!)

  const filtered = rows
    .filter((row): row is NonNullable<typeof row> => !!row)
    .map((row) => {
      const parsed = parseDispatchDecision(row.control_reason)
      return {
        dispatchId: row.id,
        workItemId: row.work_item_id,
        queueKey: row.queue_key,
        status: row.status,
        controlState: row.control_state,
        controlReason: row.control_reason,
        controlUpdatedAt: row.control_updated_at,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        arbiter: parsed,
      }
    })
    .filter((row) => input.includeNonArbiter || row.arbiter.kind === 'arbiter')
    .sort((a, b) => {
      if (a.createdAt === b.createdAt) return a.dispatchId.localeCompare(b.dispatchId)
      return a.createdAt - b.createdAt
    })

  const offset = normalizeOffset(input.offset)
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500)
  const items = filtered.slice(offset, offset + limit)

  return {
    selector: input.dispatchId
      ? { dispatchId: input.dispatchId }
      : { workItemId: input.workItemId },
    decisions: items,
    page: buildPageInfo({
      offset,
      limit,
      returned: items.length,
      total: filtered.length,
    }),
  }
}

export async function getWorkItemTriageReceiptsOp(input: GetWorkItemTriageReceiptsInput) {
  const workItem = await findWorkItemById(input.workItemId)
  if (!workItem) throw new Error('Work item not found')

  const jobs = await listJobsByWorkItem(workItem.id)
  const jobIds = jobs.map((job) => job.id)
  const activityEntries = jobIds.length > 0 ? await findActivityEntriesByJobIds(jobIds) : []
  const activityByJobId = new Map(activityEntries.map((entry) => [entry.job_id, entry]))

  const logEntries = await readTriageLogEntriesForWorkItem(workItem.id)
  const offset = normalizeOffset(input.offset)
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500)
  const sliced = logEntries.slice(offset, offset + limit)

  const jobByAgentId = new Map(jobs.map((job) => [job.agent_id, job]))

  return {
    workItemId: workItem.id,
    triageReceipts: sliced.map((entry) => {
      const agentId = typeof entry.agentId === 'string' ? entry.agentId : null
      const job = agentId ? jobByAgentId.get(agentId) : undefined
      const activity = job ? activityByJobId.get(job.id) : undefined

      return {
        timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : null,
        agentId,
        agentHandle: typeof entry.agentHandle === 'string' ? entry.agentHandle : null,
        sessionKey: typeof entry.sessionKey === 'string' ? entry.sessionKey : null,
        source: typeof entry.source === 'string' ? entry.source : null,
        model: typeof entry.model === 'string' ? entry.model : null,
        rawResponse: typeof entry.rawResponse === 'string' ? entry.rawResponse : null,
        result: {
          isReadOnly: Boolean(entry.result?.isReadOnly),
          shouldRespond: Boolean(entry.result?.shouldRespond),
          exclusiveClaim: Boolean(entry.result?.exclusiveClaim),
          reason: typeof entry.result?.reason === 'string' ? entry.result.reason : null,
          reasonAutoDerived: Boolean(entry.result?.reasonAutoDerived),
          resources: Array.isArray(entry.result?.resources)
            ? entry.result?.resources.filter((r): r is string => typeof r === 'string')
            : [],
        },
        usage:
          entry.usage && typeof entry.usage === 'object'
            ? {
                promptTokens:
                  typeof entry.usage.promptTokens === 'number' ? entry.usage.promptTokens : null,
                completionTokens:
                  typeof entry.usage.completionTokens === 'number'
                    ? entry.usage.completionTokens
                    : null,
                totalTokens:
                  typeof entry.usage.totalTokens === 'number' ? entry.usage.totalTokens : null,
                costUsd: typeof entry.usage.costUsd === 'number' ? entry.usage.costUsd : null,
                durationMs:
                  typeof entry.usage.durationMs === 'number' ? entry.usage.durationMs : null,
              }
            : null,
        job: job
          ? {
              id: job.id,
              status: job.status,
              startedAt: job.started_at,
              completedAt: job.completed_at,
            }
          : null,
        activity: activity
          ? {
              id: activity.id,
              status: activity.status,
              summary: activity.summary,
              resources: activity.resources,
              createdAt: activity.created_at,
            }
          : null,
      }
    }),
    page: buildPageInfo({
      offset,
      limit,
      returned: sliced.length,
      total: logEntries.length,
    }),
  }
}

export async function getPassiveMemoryReceiptsOp(input: {
  workItemId: string
  offset?: number
  limit?: number
}) {
  const workItem = await findWorkItemById(input.workItemId)
  if (!workItem) throw new Error('Work item not found')

  const offset = normalizeOffset(input.offset)
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500)

  const [total, rows] = await Promise.all([
    countPassiveMemoryQueueByWorkItem(workItem.id),
    listPassiveMemoryQueueByWorkItem(workItem.id, { offset, limit }),
  ])

  return {
    workItemId: workItem.id,
    passiveMemoryReceipts: rows,
    page: buildPageInfo({
      offset,
      limit,
      returned: rows.length,
      total,
    }),
  }
}

export async function getMessageChunkOp(input: GetMessageChunkInput) {
  const message = await findMessageById(input.messageId)
  if (!message) throw new Error('Message not found')

  const chunkIndex = Math.max(0, input.chunkIndex ?? 0)
  const chunkSize = Math.min(Math.max(input.chunkSize ?? 8_192, 1), 200_000)
  const source = message.content ?? ''
  const chunk = getUtf8Chunk(source, chunkIndex, chunkSize)

  return {
    message: {
      id: message.id,
      jobId: message.job_id,
      role: message.role,
      createdAt: message.created_at,
    },
    contentChunk: chunk,
  }
}
