import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import type Anthropic from '@anthropic-ai/sdk'
import {
  assertAgentGrant,
  countBackgroundTasksByJob,
  countExternalApiCallsByJob,
  countInferenceCallsByJob,
  countMessagesByJob,
  countQueueMessagesByWorkItem,
  countSpansByJob,
  findActivityEntriesByJobIds,
  findJobById,
  findMessageById,
  findRunDispatchById,
  findRunDispatchByJobId,
  findWorkItemById,
  getCostByJobs,
  getCostByWorkItems,
  getJobSpanSummary,
  listBackgroundTasksByJobPaged,
  listEffectOutboxByWorkItem,
  listExternalApiCallsByJobPaged,
  listInferenceCallsByJobPaged,
  listInferenceCallsByJobWithPayloadsPaged,
  listJobsByWorkItem,
  listMessagesByJobPaged,
  listQueueMessagesByWorkItem,
  listRunDispatchesByWorkItem,
  listSpansByJobPaged,
  searchRuns,
  searchWorkItems,
} from '@nitejar/database'
import type { ToolHandler } from '../types'

const TRIAGE_LOG_RELATIVE_PATH = path.join('logs', 'triage.jsonl')
const TRIAGE_LOG_SEARCH_UP_LEVELS = 6

type CursorValue = {
  createdAt: number
  id: string
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

type ParsedDispatchDecision = {
  kind: 'arbiter' | 'control'
  decision: string | null
  reason: string | null
}

function normalizeOffset(value: unknown): number {
  return Math.max(0, typeof value === 'number' ? Math.floor(value) : 0)
}

function resolvePageLimit(total: number, offset: number, limit: unknown, max: number): number {
  const requested = typeof limit === 'number' ? Math.floor(limit) : max
  return Math.min(Math.max(requested, 1), max, Math.max(total - offset, 0) || requested)
}

function buildPageInfo(input: { offset: number; limit: number; returned: number; total: number }) {
  return {
    offset: input.offset,
    limit: input.limit,
    returned: input.returned,
    total: input.total,
    hasMore: input.offset + input.returned < input.total,
    nextOffset: input.offset + input.returned < input.total ? input.offset + input.returned : null,
  }
}

function truncateUtf8(input: string, maxBytes: number) {
  if (Buffer.byteLength(input, 'utf8') <= maxBytes) {
    return { text: input, truncated: false }
  }

  let end = input.length
  let text = input
  while (end > 0 && Buffer.byteLength(text, 'utf8') > maxBytes) {
    end = Math.floor(end * 0.75)
    text = input.slice(0, end)
  }

  while (end < input.length && Buffer.byteLength(input.slice(0, end + 1), 'utf8') <= maxBytes) {
    end += 1
  }

  const finalText = input.slice(0, end)
  return { text: finalText, truncated: true }
}

function getUtf8Chunk(source: string, chunkIndex: number, chunkSize: number) {
  const totalBytes = Buffer.byteLength(source, 'utf8')
  const startByte = chunkIndex * chunkSize
  if (startByte >= totalBytes) {
    return {
      chunkIndex,
      chunkSize,
      totalBytes,
      totalChunks: Math.ceil(totalBytes / chunkSize),
      startByte,
      endByte: startByte,
      text: '',
      hasMore: false,
    }
  }

  const endByteExclusive = Math.min(totalBytes, startByte + chunkSize)
  const slice = Buffer.from(source, 'utf8').subarray(startByte, endByteExclusive)
  return {
    chunkIndex,
    chunkSize,
    totalBytes,
    totalChunks: Math.ceil(totalBytes / chunkSize),
    startByte,
    endByte: endByteExclusive,
    text: slice.toString('utf8'),
    hasMore: endByteExclusive < totalBytes,
  }
}

function encodeCursor(cursor: CursorValue | null): string | null {
  if (!cursor) return null
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string | undefined): CursorValue | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt?: unknown
      id?: unknown
    }
    if (typeof parsed.createdAt !== 'number' || !Number.isFinite(parsed.createdAt)) return null
    if (typeof parsed.id !== 'string' || parsed.id.trim().length === 0) return null
    return { createdAt: parsed.createdAt, id: parsed.id }
  } catch {
    return null
  }
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

async function requireFleetRunRead(context: { agentId?: string }) {
  if (!context.agentId) {
    throw new Error('Agent context is required.')
  }
  await assertAgentGrant({
    agentId: context.agentId,
    action: 'fleet.run.read',
    resourceType: 'run',
  })
}

async function requireFleetWorkRead(context: { agentId?: string }) {
  if (!context.agentId) {
    throw new Error('Agent context is required.')
  }
  await assertAgentGrant({
    agentId: context.agentId,
    action: 'fleet.work.read',
    resourceType: 'work_item',
  })
}

async function resolveTriageLogPath(): Promise<string | null> {
  let currentDir = process.cwd()

  for (let depth = 0; depth <= TRIAGE_LOG_SEARCH_UP_LEVELS; depth++) {
    const candidate = path.resolve(currentDir, TRIAGE_LOG_RELATIVE_PATH)
    try {
      await access(candidate)
      return candidate
    } catch {
      // Keep searching parent directories.
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
      // Ignore malformed lines so receipts stay resilient.
    }
  }

  return entries.sort((a, b) => {
    const aTs = typeof a.timestamp === 'string' ? Date.parse(a.timestamp) : 0
    const bTs = typeof b.timestamp === 'string' ? Date.parse(b.timestamp) : 0
    return aTs - bTs
  })
}

function outputJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

export const searchRunsDefinition: Anthropic.Tool = {
  name: 'search_runs',
  description:
    'Search runs across the fleet with filters for agent, work item, source, time range, and text query. Returns structured run rows plus a cursor for paging.',
  input_schema: {
    type: 'object' as const,
    properties: {
      q: {
        type: 'string',
        description: 'Optional keyword, run id, work item id, title, handle, or session query.',
      },
      statuses: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional run statuses to include.',
      },
      agentId: { type: 'string', description: 'Optional agent id filter.' },
      workItemId: { type: 'string', description: 'Optional work item id filter.' },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional source filters, like telegram or github.',
      },
      pluginInstanceId: { type: 'string', description: 'Optional plugin instance filter.' },
      sessionKeyPrefix: { type: 'string', description: 'Optional session key prefix filter.' },
      createdAfter: { type: 'number', description: 'Optional unix timestamp lower bound.' },
      createdBefore: { type: 'number', description: 'Optional unix timestamp upper bound.' },
      limit: { type: 'number', description: 'Page size, max 100.' },
      cursor: { type: 'string', description: 'Opaque cursor from a prior search_runs result.' },
    },
  },
}

export const searchRunsTool: ToolHandler = async (input, context) => {
  try {
    await requireFleetRunRead(context)
    const cursorInput = typeof input.cursor === 'string' ? decodeCursor(input.cursor) : null
    if (typeof input.cursor === 'string' && !cursorInput) {
      return { success: false, error: 'Invalid cursor.' }
    }

    const result = await searchRuns({
      q: typeof input.q === 'string' ? input.q : undefined,
      statuses: Array.isArray(input.statuses)
        ? input.statuses.filter((value): value is string => typeof value === 'string')
        : undefined,
      agentId: typeof input.agentId === 'string' ? input.agentId : undefined,
      workItemId: typeof input.workItemId === 'string' ? input.workItemId : undefined,
      sources: Array.isArray(input.sources)
        ? input.sources.filter((value): value is string => typeof value === 'string')
        : undefined,
      pluginInstanceId:
        typeof input.pluginInstanceId === 'string' ? input.pluginInstanceId : undefined,
      sessionKeyPrefix:
        typeof input.sessionKeyPrefix === 'string' ? input.sessionKeyPrefix : undefined,
      createdAfter: typeof input.createdAfter === 'number' ? input.createdAfter : undefined,
      createdBefore: typeof input.createdBefore === 'number' ? input.createdBefore : undefined,
      limit: typeof input.limit === 'number' ? input.limit : undefined,
      cursor: cursorInput,
    })

    return {
      success: true,
      output: outputJson({
        runs: result.runs,
        nextCursor: encodeCursor(result.nextCursor),
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const getRunTraceDefinition: Anthropic.Tool = {
  name: 'get_run_trace',
  description:
    'Inspect a run in detail with spans, messages, inference calls, background tasks, external calls, and dispatch receipts. Use the paging inputs to skip around large traces.',
  input_schema: {
    type: 'object' as const,
    properties: {
      jobId: { type: 'string', description: 'Run/job id to inspect.' },
      includeSpans: { type: 'boolean' },
      includeMessages: { type: 'boolean' },
      includeInferenceCalls: { type: 'boolean' },
      includeBackgroundTasks: { type: 'boolean' },
      includeExternalCalls: { type: 'boolean' },
      includeDispatch: { type: 'boolean' },
      spanOffset: { type: 'number' },
      spanLimit: { type: 'number' },
      messageOffset: { type: 'number' },
      messageLimit: { type: 'number' },
      includeFullMessageContent: { type: 'boolean' },
      maxContentBytes: { type: 'number' },
      includeInferencePayloads: { type: 'boolean' },
      inferencePayloadMaxBytes: { type: 'number' },
      inferenceCallOffset: { type: 'number' },
      inferenceCallLimit: { type: 'number' },
      backgroundTaskOffset: { type: 'number' },
      backgroundTaskLimit: { type: 'number' },
      externalCallOffset: { type: 'number' },
      externalCallLimit: { type: 'number' },
    },
    required: ['jobId'],
  },
}

export const getRunTraceTool: ToolHandler = async (input, context) => {
  try {
    await requireFleetRunRead(context)
    const jobId = typeof input.jobId === 'string' ? input.jobId.trim() : ''
    if (!jobId) return { success: false, error: 'jobId is required.' }

    const run = await findJobById(jobId)
    if (!run) return { success: false, error: 'Run not found.' }

    const spanOffset = normalizeOffset(input.spanOffset)
    const messageOffset = normalizeOffset(input.messageOffset)
    const inferenceCallOffset = normalizeOffset(input.inferenceCallOffset)
    const backgroundTaskOffset = normalizeOffset(input.backgroundTaskOffset)
    const externalCallOffset = normalizeOffset(input.externalCallOffset)

    const [
      summary,
      costs,
      spanTotal,
      messageTotal,
      inferenceCallTotal,
      backgroundTaskTotal,
      externalCallTotal,
      dispatch,
    ] = await Promise.all([
      getJobSpanSummary(run.id),
      getCostByJobs([run.id]),
      input.includeSpans ? countSpansByJob(run.id) : Promise.resolve(0),
      input.includeMessages ? countMessagesByJob(run.id) : Promise.resolve(0),
      input.includeInferenceCalls ? countInferenceCallsByJob(run.id) : Promise.resolve(0),
      input.includeBackgroundTasks ? countBackgroundTasksByJob(run.id) : Promise.resolve(0),
      input.includeExternalCalls ? countExternalApiCallsByJob(run.id) : Promise.resolve(0),
      input.includeDispatch ? findRunDispatchByJobId(run.id) : Promise.resolve(undefined),
    ])

    const spanLimit = resolvePageLimit(spanTotal, spanOffset, input.spanLimit, 1000)
    const messageLimit = resolvePageLimit(messageTotal, messageOffset, input.messageLimit, 500)
    const inferenceCallLimit = resolvePageLimit(
      inferenceCallTotal,
      inferenceCallOffset,
      input.inferenceCallLimit,
      500
    )
    const backgroundTaskLimit = resolvePageLimit(
      backgroundTaskTotal,
      backgroundTaskOffset,
      input.backgroundTaskLimit,
      500
    )
    const externalCallLimit = resolvePageLimit(
      externalCallTotal,
      externalCallOffset,
      input.externalCallLimit,
      500
    )

    const includeInferencePayloads = input.includeInferencePayloads === true
    const [spans, messages, inferenceCalls, backgroundTasks, externalCalls] = await Promise.all([
      input.includeSpans
        ? listSpansByJobPaged(run.id, { offset: spanOffset, limit: spanLimit })
        : Promise.resolve(undefined),
      input.includeMessages
        ? listMessagesByJobPaged(run.id, { offset: messageOffset, limit: messageLimit })
        : Promise.resolve(undefined),
      input.includeInferenceCalls
        ? includeInferencePayloads
          ? listInferenceCallsByJobWithPayloadsPaged(run.id, {
              offset: inferenceCallOffset,
              limit: inferenceCallLimit,
            })
          : listInferenceCallsByJobPaged(run.id, {
              offset: inferenceCallOffset,
              limit: inferenceCallLimit,
            })
        : Promise.resolve(undefined),
      input.includeBackgroundTasks
        ? listBackgroundTasksByJobPaged(run.id, {
            offset: backgroundTaskOffset,
            limit: backgroundTaskLimit,
          })
        : Promise.resolve(undefined),
      input.includeExternalCalls
        ? listExternalApiCallsByJobPaged(run.id, {
            offset: externalCallOffset,
            limit: externalCallLimit,
          })
        : Promise.resolve(undefined),
    ])

    const includeFullMessageContent = input.includeFullMessageContent !== false
    const maxContentBytes =
      typeof input.maxContentBytes === 'number' ? Math.floor(input.maxContentBytes) : undefined
    const inferencePayloadMaxBytes =
      typeof input.inferencePayloadMaxBytes === 'number'
        ? Math.floor(input.inferencePayloadMaxBytes)
        : undefined

    const normalizedMessages = messages?.map((message) => {
      const content = message.content ?? ''
      const contentBytes = Buffer.byteLength(content, 'utf8')

      if (!includeFullMessageContent) {
        return {
          ...message,
          content: null,
          contentMeta: {
            omitted: true,
            truncated: false,
            contentBytes,
            returnedBytes: 0,
          },
        }
      }

      if (typeof maxContentBytes === 'number' && content.length > 0) {
        const truncated = truncateUtf8(content, maxContentBytes)
        return {
          ...message,
          content: truncated.text,
          contentMeta: {
            omitted: false,
            truncated: truncated.truncated,
            contentBytes,
            returnedBytes: Buffer.byteLength(truncated.text, 'utf8'),
          },
        }
      }

      return {
        ...message,
        contentMeta: {
          omitted: false,
          truncated: false,
          contentBytes,
          returnedBytes: contentBytes,
        },
      }
    })

    const normalizedInferenceCalls = inferenceCalls?.map((entry) => {
      const baseMeta = {
        omitted: !includeInferencePayloads,
        truncated: false,
        contentBytes: null as number | null,
        returnedBytes: includeInferencePayloads ? 0 : null,
      }

      if (!includeInferencePayloads || !('request_payload_json' in entry)) {
        return {
          ...entry,
          request_payload_json: null,
          request_payload_metadata_json:
            'request_payload_metadata_json' in entry
              ? ((entry.request_payload_metadata_json as string | null) ?? null)
              : null,
          response_payload_json: null,
          response_payload_metadata_json:
            'response_payload_metadata_json' in entry
              ? ((entry.response_payload_metadata_json as string | null) ?? null)
              : null,
          request_payload_byte_size: null,
          response_payload_byte_size: null,
          requestPayloadMeta: baseMeta,
          responsePayloadMeta: baseMeta,
        }
      }

      const withPayload = entry as typeof entry & {
        request_payload_json: string | null
        request_payload_byte_size: number | null
        response_payload_json: string | null
        response_payload_byte_size: number | null
      }

      const normalizePayload = (payload: string | null, byteSize: number | null) => {
        const content = payload ?? ''
        const contentBytes =
          typeof byteSize === 'number' ? byteSize : Buffer.byteLength(content, 'utf8')
        if (!payload) {
          return {
            value: null,
            meta: {
              omitted: false,
              truncated: false,
              contentBytes,
              returnedBytes: 0,
            },
          }
        }

        if (typeof inferencePayloadMaxBytes === 'number') {
          const truncated = truncateUtf8(payload, inferencePayloadMaxBytes)
          return {
            value: truncated.text,
            meta: {
              omitted: false,
              truncated: truncated.truncated,
              contentBytes,
              returnedBytes: Buffer.byteLength(truncated.text, 'utf8'),
            },
          }
        }

        return {
          value: payload,
          meta: {
            omitted: false,
            truncated: false,
            contentBytes,
            returnedBytes: Buffer.byteLength(payload, 'utf8'),
          },
        }
      }

      const requestPayload = normalizePayload(
        withPayload.request_payload_json,
        withPayload.request_payload_byte_size
      )
      const responsePayload = normalizePayload(
        withPayload.response_payload_json,
        withPayload.response_payload_byte_size
      )

      return {
        ...entry,
        request_payload_json: requestPayload.value,
        response_payload_json: responsePayload.value,
        requestPayloadMeta: requestPayload.meta,
        responsePayloadMeta: responsePayload.meta,
      }
    })

    return {
      success: true,
      output: outputJson({
        run,
        cost: costs[0] ?? null,
        summary,
        ...(spans
          ? {
              spans,
              spansPage: buildPageInfo({
                offset: spanOffset,
                limit: spanLimit,
                returned: spans.length,
                total: spanTotal,
              }),
            }
          : {}),
        ...(normalizedMessages
          ? {
              messages: normalizedMessages,
              messagesPage: buildPageInfo({
                offset: messageOffset,
                limit: messageLimit,
                returned: normalizedMessages.length,
                total: messageTotal,
              }),
            }
          : {}),
        ...(normalizedInferenceCalls
          ? {
              inferenceCalls: normalizedInferenceCalls,
              inferenceCallsPage: buildPageInfo({
                offset: inferenceCallOffset,
                limit: inferenceCallLimit,
                returned: normalizedInferenceCalls.length,
                total: inferenceCallTotal,
              }),
            }
          : {}),
        ...(backgroundTasks
          ? {
              backgroundTasks,
              backgroundTasksPage: buildPageInfo({
                offset: backgroundTaskOffset,
                limit: backgroundTaskLimit,
                returned: backgroundTasks.length,
                total: backgroundTaskTotal,
              }),
            }
          : {}),
        ...(externalCalls
          ? {
              externalCalls,
              externalCallsPage: buildPageInfo({
                offset: externalCallOffset,
                limit: externalCallLimit,
                returned: externalCalls.length,
                total: externalCallTotal,
              }),
            }
          : {}),
        ...(dispatch ? { dispatch } : {}),
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const searchWorkItemsDefinition: Anthropic.Tool = {
  name: 'search_work_items',
  description:
    'Search work items across the fleet with filters for status, source, agent, plugin instance, session, and time range. Returns structured rows plus a cursor for paging.',
  input_schema: {
    type: 'object' as const,
    properties: {
      q: { type: 'string' },
      statuses: { type: 'array', items: { type: 'string' } },
      sources: { type: 'array', items: { type: 'string' } },
      pluginInstanceId: { type: 'string' },
      agentId: { type: 'string' },
      sessionKeyPrefix: { type: 'string' },
      createdAfter: { type: 'number' },
      createdBefore: { type: 'number' },
      limit: { type: 'number' },
      cursor: { type: 'string' },
    },
  },
}

export const searchWorkItemsTool: ToolHandler = async (input, context) => {
  try {
    await requireFleetWorkRead(context)
    const cursorInput = typeof input.cursor === 'string' ? decodeCursor(input.cursor) : null
    if (typeof input.cursor === 'string' && !cursorInput) {
      return { success: false, error: 'Invalid cursor.' }
    }

    const result = await searchWorkItems({
      q: typeof input.q === 'string' ? input.q : undefined,
      statuses: Array.isArray(input.statuses)
        ? input.statuses.filter((value): value is string => typeof value === 'string')
        : undefined,
      sources: Array.isArray(input.sources)
        ? input.sources.filter((value): value is string => typeof value === 'string')
        : undefined,
      pluginInstanceId:
        typeof input.pluginInstanceId === 'string' ? input.pluginInstanceId : undefined,
      agentId: typeof input.agentId === 'string' ? input.agentId : undefined,
      sessionKeyPrefix:
        typeof input.sessionKeyPrefix === 'string' ? input.sessionKeyPrefix : undefined,
      createdAfter: typeof input.createdAfter === 'number' ? input.createdAfter : undefined,
      createdBefore: typeof input.createdBefore === 'number' ? input.createdBefore : undefined,
      limit: typeof input.limit === 'number' ? input.limit : undefined,
      cursor: cursorInput,
    })

    const costs = await getCostByWorkItems(result.items.map((item) => item.id))
    const costMap = new Map(costs.map((row) => [row.work_item_id, row]))

    return {
      success: true,
      output: outputJson({
        items: result.items.map((item) => ({
          ...item,
          cost: costMap.get(item.id) ?? null,
        })),
        nextCursor: encodeCursor(result.nextCursor),
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const getWorkItemDefinition: Anthropic.Tool = {
  name: 'get_work_item',
  description:
    'Inspect a work item with optional linked runs, dispatches, and effects. Use this as the drill-in after search_work_items.',
  input_schema: {
    type: 'object' as const,
    properties: {
      workItemId: { type: 'string', description: 'Work item id to inspect.' },
      includeRuns: { type: 'boolean' },
      includeDispatches: { type: 'boolean' },
      includeEffects: { type: 'boolean' },
    },
    required: ['workItemId'],
  },
}

export const getWorkItemTool: ToolHandler = async (input, context) => {
  try {
    await requireFleetWorkRead(context)
    const workItemId = typeof input.workItemId === 'string' ? input.workItemId.trim() : ''
    if (!workItemId) return { success: false, error: 'workItemId is required.' }

    const workItem = await findWorkItemById(workItemId)
    if (!workItem) return { success: false, error: 'Work item not found.' }

    const costs = await getCostByWorkItems([workItem.id])
    const [runs, dispatches, effects] = await Promise.all([
      input.includeRuns ? listJobsByWorkItem(workItem.id) : Promise.resolve(undefined),
      input.includeDispatches
        ? listRunDispatchesByWorkItem(workItem.id)
        : Promise.resolve(undefined),
      input.includeEffects ? listEffectOutboxByWorkItem(workItem.id) : Promise.resolve(undefined),
    ])

    return {
      success: true,
      output: outputJson({
        workItem,
        cost: costs[0] ?? null,
        ...(runs ? { runs } : {}),
        ...(dispatches ? { dispatches } : {}),
        ...(effects ? { effects } : {}),
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const getWorkItemQueueMessagesDefinition: Anthropic.Tool = {
  name: 'get_work_item_queue_messages',
  description:
    'Inspect queue messages for a work item, including queued, claimed, passed, or completed dispatch attempts. Useful when figuring out what happened to delegated work.',
  input_schema: {
    type: 'object' as const,
    properties: {
      workItemId: { type: 'string' },
      statuses: { type: 'array', items: { type: 'string' } },
      offset: { type: 'number' },
      limit: { type: 'number' },
    },
    required: ['workItemId'],
  },
}

export const getWorkItemQueueMessagesTool: ToolHandler = async (input, context) => {
  try {
    await requireFleetWorkRead(context)
    const workItemId = typeof input.workItemId === 'string' ? input.workItemId.trim() : ''
    if (!workItemId) return { success: false, error: 'workItemId is required.' }

    const workItem = await findWorkItemById(workItemId)
    if (!workItem) return { success: false, error: 'Work item not found.' }

    const offset = normalizeOffset(input.offset)
    const limit = Math.min(Math.max(typeof input.limit === 'number' ? input.limit : 100, 1), 500)
    const statuses = Array.isArray(input.statuses)
      ? input.statuses.filter((value): value is string => typeof value === 'string')
      : undefined

    const [total, queueMessages] = await Promise.all([
      countQueueMessagesByWorkItem(workItem.id),
      listQueueMessagesByWorkItem(workItem.id, { offset, limit, statuses }),
    ])

    return {
      success: true,
      output: outputJson({
        workItemId: workItem.id,
        queueMessages,
        page: buildPageInfo({
          offset,
          limit,
          returned: queueMessages.length,
          total,
        }),
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const getDispatchDecisionsDefinition: Anthropic.Tool = {
  name: 'get_dispatch_decisions',
  description:
    'Inspect dispatch and arbiter decisions for a work item or a specific dispatch. Use this to see why routing passed, claimed, or skipped.',
  input_schema: {
    type: 'object' as const,
    properties: {
      workItemId: { type: 'string' },
      dispatchId: { type: 'string' },
      includeNonArbiter: { type: 'boolean' },
      offset: { type: 'number' },
      limit: { type: 'number' },
    },
  },
}

export const getDispatchDecisionsTool: ToolHandler = async (input, context) => {
  try {
    await requireFleetWorkRead(context)
    const workItemId = typeof input.workItemId === 'string' ? input.workItemId.trim() : ''
    const dispatchId = typeof input.dispatchId === 'string' ? input.dispatchId.trim() : ''
    if ((!workItemId && !dispatchId) || (workItemId && dispatchId)) {
      return { success: false, error: 'Provide exactly one of workItemId or dispatchId.' }
    }

    const rows = dispatchId
      ? [await findRunDispatchById(dispatchId)]
      : await listRunDispatchesByWorkItem(workItemId)

    const includeNonArbiter = input.includeNonArbiter === true
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
      .filter((row) => includeNonArbiter || row.arbiter.kind === 'arbiter')
      .sort((a, b) => {
        if (a.createdAt === b.createdAt) return a.dispatchId.localeCompare(b.dispatchId)
        return a.createdAt - b.createdAt
      })

    const offset = normalizeOffset(input.offset)
    const limit = Math.min(Math.max(typeof input.limit === 'number' ? input.limit : 100, 1), 500)
    const decisions = filtered.slice(offset, offset + limit)

    return {
      success: true,
      output: outputJson({
        selector: dispatchId ? { dispatchId } : { workItemId },
        decisions,
        page: buildPageInfo({
          offset,
          limit,
          returned: decisions.length,
          total: filtered.length,
        }),
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const getWorkItemTriageReceiptsDefinition: Anthropic.Tool = {
  name: 'get_work_item_triage_receipts',
  description:
    'Inspect triage receipts for a work item, including arbiter raw responses, reasons, usage, and linked activity. Useful for understanding why agents did or did not pick something up.',
  input_schema: {
    type: 'object' as const,
    properties: {
      workItemId: { type: 'string' },
      offset: { type: 'number' },
      limit: { type: 'number' },
    },
    required: ['workItemId'],
  },
}

export const getWorkItemTriageReceiptsTool: ToolHandler = async (input, context) => {
  try {
    await requireFleetWorkRead(context)
    const workItemId = typeof input.workItemId === 'string' ? input.workItemId.trim() : ''
    if (!workItemId) return { success: false, error: 'workItemId is required.' }

    const workItem = await findWorkItemById(workItemId)
    if (!workItem) return { success: false, error: 'Work item not found.' }

    const jobs = await listJobsByWorkItem(workItem.id)
    const jobIds = jobs.map((job) => job.id)
    const activityEntries = jobIds.length > 0 ? await findActivityEntriesByJobIds(jobIds) : []
    const activityByJobId = new Map(activityEntries.map((entry) => [entry.job_id, entry]))
    const logEntries = await readTriageLogEntriesForWorkItem(workItem.id)

    const offset = normalizeOffset(input.offset)
    const limit = Math.min(Math.max(typeof input.limit === 'number' ? input.limit : 100, 1), 500)
    const sliced = logEntries.slice(offset, offset + limit)
    const jobByAgentId = new Map(jobs.map((job) => [job.agent_id, job]))

    return {
      success: true,
      output: outputJson({
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
                ? entry.result.resources.filter(
                    (value): value is string => typeof value === 'string'
                  )
                : [],
            },
            usage:
              entry.usage && typeof entry.usage === 'object'
                ? {
                    promptTokens:
                      typeof entry.usage.promptTokens === 'number'
                        ? entry.usage.promptTokens
                        : null,
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
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const getMessageChunkDefinition: Anthropic.Tool = {
  name: 'get_message_chunk',
  description:
    'Read a large stored message in chunks. Use this when get_run or get_run_trace tells you a message was truncated and you need to page through the raw content.',
  input_schema: {
    type: 'object' as const,
    properties: {
      messageId: { type: 'string' },
      chunkIndex: { type: 'number' },
      chunkSize: { type: 'number' },
    },
    required: ['messageId'],
  },
}

export const getMessageChunkTool: ToolHandler = async (input, context) => {
  try {
    await requireFleetRunRead(context)
    const messageId = typeof input.messageId === 'string' ? input.messageId.trim() : ''
    if (!messageId) return { success: false, error: 'messageId is required.' }

    const message = await findMessageById(messageId)
    if (!message) return { success: false, error: 'Message not found.' }

    const chunkIndex = normalizeOffset(input.chunkIndex)
    const chunkSize = Math.min(
      Math.max(typeof input.chunkSize === 'number' ? input.chunkSize : 8_192, 1),
      200_000
    )

    return {
      success: true,
      output: outputJson({
        message: {
          id: message.id,
          jobId: message.job_id,
          role: message.role,
          createdAt: message.created_at,
        },
        contentChunk: getUtf8Chunk(message.content ?? '', chunkIndex, chunkSize),
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const fleetObservabilityDefinitions: Anthropic.Tool[] = [
  searchRunsDefinition,
  getRunTraceDefinition,
  searchWorkItemsDefinition,
  getWorkItemDefinition,
  getWorkItemQueueMessagesDefinition,
  getDispatchDecisionsDefinition,
  getWorkItemTriageReceiptsDefinition,
  getMessageChunkDefinition,
]

export const __fleetObservabilityTest = {
  normalizeOffset,
  resolvePageLimit,
  buildPageInfo,
  truncateUtf8,
  getUtf8Chunk,
  encodeCursor,
  decodeCursor,
  parseDispatchDecision,
  resolveTriageLogPath,
  readTriageLogEntriesForWorkItem,
}
