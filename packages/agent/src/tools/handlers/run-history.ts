import type Anthropic from '@anthropic-ai/sdk'
import {
  assertAgentGrant,
  countBackgroundTasksByJob,
  countMessagesByJob,
  listRunHistoryForAgent,
  findJobById,
  findWorkItemById,
  getJobSpanSummary,
  listSpansByJob,
  getCostByJobs,
  listMessagesByJob,
  listMessagesByJobPaged,
  findActivityByJobId,
  listBackgroundTasksByJobPaged,
} from '@nitejar/database'
import type { ToolHandler } from '../types'

// ---------------------------------------------------------------------------
// list_runs — compact index of past runs
// ---------------------------------------------------------------------------

export const listRunsDefinition: Anthropic.Tool = {
  name: 'list_runs',
  description:
    'List your past runs (jobs). Returns a compact one-liner per run with status, title, source, duration, and cost. Use get_run to drill into a specific run.',
  input_schema: {
    type: 'object' as const,
    properties: {
      status: {
        type: 'string',
        enum: ['completed', 'failed', 'cancelled', 'all'],
        description: 'Filter by run status (default: all).',
      },
      source: {
        type: 'string',
        description: 'Filter by source (e.g. "telegram", "github", "manual").',
      },
      max_age_days: {
        type: 'integer',
        description: 'How far back to look in days (default: 7, max: 90).',
      },
      limit: {
        type: 'integer',
        description: 'Maximum results to return (default: 10, max: 50).',
      },
    },
  },
}

export const listRunsTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Agent context is required.' }
  }

  const status = typeof input.status === 'string' ? input.status : 'all'
  const source = typeof input.source === 'string' ? input.source.trim() : undefined
  const maxAgeDays = Math.min(
    Math.max(typeof input.max_age_days === 'number' ? input.max_age_days : 7, 1),
    90
  )
  const limit = Math.min(Math.max(typeof input.limit === 'number' ? input.limit : 10, 1), 50)

  const nowUnix = Math.floor(Date.now() / 1000)
  const sinceUnix = nowUnix - maxAgeDays * 86400

  const entries = await listRunHistoryForAgent(context.agentId, {
    status,
    source,
    sinceUnix,
    limit,
  })

  if (entries.length === 0) {
    return { success: true, output: 'No runs found matching the criteria.' }
  }

  const lines = entries.map((entry) => {
    const age = formatAge(nowUnix - entry.created_at)
    const duration = formatDuration(entry.started_at, entry.completed_at)
    const cost = entry.total_cost > 0 ? `$${entry.total_cost.toFixed(4)}` : '$0'
    const title = entry.title || '(untitled)'
    return `- [${age}] run:${entry.job_id} ${entry.status} "${title}" (${entry.source}) — ${duration}, ${cost}`
  })

  return { success: true, output: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// get_run — drill into a specific run
// ---------------------------------------------------------------------------

export const getRunDefinition: Anthropic.Tool = {
  name: 'get_run',
  description:
    'Get details of a specific run. Legacy section mode still works for compact response/summary/timeline/messages views. With fleet run read access, you can also inspect any run with structured pagination for messages, background tasks, and control state.',
  input_schema: {
    type: 'object' as const,
    properties: {
      run_id: {
        type: 'string',
        description: 'Legacy alias for the run/job id.',
      },
      jobId: {
        type: 'string',
        description: 'Run/job id to inspect.',
      },
      section: {
        type: 'string',
        enum: ['response', 'summary', 'timeline', 'messages'],
        description: 'Legacy compact view selector. If omitted, the tool returns a structured run record.',
      },
      offset: {
        type: 'integer',
        description: 'Legacy messages section offset.',
      },
      limit: {
        type: 'integer',
        description: 'Legacy messages section limit (default: 20, max: 50).',
      },
      includeMessages: {
        type: 'boolean',
        description: 'Structured mode: include paged stored messages.',
      },
      includeBackgroundTasks: {
        type: 'boolean',
        description: 'Structured mode: include paged background tasks.',
      },
      includeControl: {
        type: 'boolean',
        description: 'Structured mode: include current run control state when available.',
      },
      messageOffset: {
        type: 'integer',
        description: 'Structured mode: skip N messages.',
      },
      messageLimit: {
        type: 'integer',
        description: 'Structured mode: max messages to return (default: 50, max: 500).',
      },
      includeFullMessageContent: {
        type: 'boolean',
        description: 'Structured mode: include full message content instead of metadata only.',
      },
      maxContentBytes: {
        type: 'integer',
        description: 'Structured mode: truncate each message body to this many bytes.',
      },
      backgroundTaskOffset: {
        type: 'integer',
        description: 'Structured mode: skip N background tasks.',
      },
      backgroundTaskLimit: {
        type: 'integer',
        description: 'Structured mode: max background tasks to return (default: 50, max: 500).',
      },
    },
  },
}

export const getRunTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Agent context is required.' }
  }

  const runId =
    typeof input.jobId === 'string'
      ? input.jobId.trim()
      : typeof input.run_id === 'string'
        ? input.run_id.trim()
        : ''
  if (!runId) {
    return { success: false, error: 'jobId or run_id is required.' }
  }

  const section = typeof input.section === 'string' ? input.section : 'response'

  const job = await findJobById(runId)
  if (!job) {
    return { success: false, error: `Run "${runId}" not found.` }
  }

  let canInspectFleetRuns = false
  try {
    await assertAgentGrant({
      agentId: context.agentId,
      action: 'fleet.run.read',
      resourceType: 'run',
    })
    canInspectFleetRuns = true
  } catch {
    canInspectFleetRuns = false
  }

  if (!canInspectFleetRuns && job.agent_id !== context.agentId) {
    return { success: false, error: `Run "${runId}" belongs to a different agent.` }
  }

  const wantsStructuredMode =
    'includeMessages' in input ||
    'includeBackgroundTasks' in input ||
    'includeControl' in input ||
    'messageOffset' in input ||
    'messageLimit' in input ||
    'includeFullMessageContent' in input ||
    'maxContentBytes' in input ||
    'backgroundTaskOffset' in input ||
    'backgroundTaskLimit' in input

  if (wantsStructuredMode) {
    return buildStructuredRunSection(job, input)
  }

  switch (section) {
    case 'response':
      return buildResponseSection(job)
    case 'summary':
      return buildSummarySection(job)
    case 'timeline':
      return buildTimelineSection(job)
    case 'messages':
      return buildMessagesSection(job, input)
    default:
      return {
        success: false,
        error: `Unknown section "${section}". Use: response, summary, timeline, or messages.`,
      }
  }
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

async function buildResponseSection(job: {
  id: string
  final_response: string | null
}): Promise<{ success: boolean; output?: string; error?: string }> {
  // Prefer post-processed final_response
  if (job.final_response) {
    return { success: true, output: job.final_response }
  }

  // Fall back to collecting assistant messages
  const messages = await listMessagesByJob(job.id)
  const assistantTexts: string[] = []

  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.content) continue
    try {
      const parsed: unknown = JSON.parse(msg.content)
      // Content can be a string or array of content blocks
      if (typeof parsed === 'string') {
        assistantTexts.push(parsed)
      } else if (Array.isArray(parsed)) {
        for (const block of parsed as unknown[]) {
          if (
            block &&
            typeof block === 'object' &&
            'text' in (block as Record<string, unknown>) &&
            typeof (block as Record<string, unknown>).text === 'string'
          ) {
            assistantTexts.push((block as Record<string, unknown>).text as string)
          }
        }
      }
    } catch {
      // Raw text content
      assistantTexts.push(msg.content)
    }
  }

  if (assistantTexts.length === 0) {
    return { success: true, output: '(No response content found for this run.)' }
  }

  return { success: true, output: assistantTexts.join('\n\n') }
}

async function buildSummarySection(job: {
  id: string
  work_item_id: string
  status: string
  started_at: number | null
  completed_at: number | null
  error_text: string | null
}): Promise<{ success: boolean; output?: string }> {
  const [workItem, spanSummary, costRows, activity] = await Promise.all([
    findWorkItemById(job.work_item_id),
    getJobSpanSummary(job.id),
    getCostByJobs([job.id]),
    findActivityByJobId(job.id),
  ])

  const cost = costRows[0]
  const duration = formatDuration(job.started_at, job.completed_at)
  const tokenSummary = cost
    ? `${cost.prompt_tokens} prompt + ${cost.completion_tokens} completion tokens`
    : 'unknown'
  const costStr = cost ? `$${cost.total_cost.toFixed(4)}` : '$0'

  const lines = [
    `Run ${job.id} — ${job.status}`,
    `Title: ${workItem?.title ?? '(unknown)'}`,
    `Source: ${workItem?.source ?? '(unknown)'}${workItem?.source_ref ? ` (${workItem.source_ref})` : ''}`,
    `Duration: ${duration} (${spanSummary.turn_count} turns, ${spanSummary.tool_count} tool calls)`,
    `Cost: ${costStr} (${tokenSummary})`,
  ]

  if (activity?.summary) {
    lines.push(`Triage: ${activity.summary}`)
  }

  lines.push(`Error: ${job.error_text ?? '(none)'}`)

  return { success: true, output: lines.join('\n') }
}

async function buildTimelineSection(job: {
  id: string
}): Promise<{ success: boolean; output?: string }> {
  const spans = await listSpansByJob(job.id)

  if (spans.length === 0) {
    return { success: true, output: '(No spans recorded for this run.)' }
  }

  // Group into turns: each "turn" span is a top-level container
  const turnSpans = spans.filter((s) => s.name === 'turn')
  if (turnSpans.length === 0) {
    // No turn structure — show flat list
    const lines = spans.map((s) => {
      const dur = s.duration_ms != null ? `${(s.duration_ms / 1000).toFixed(1)}s` : '?'
      return `  ${s.name}${s.status === 'error' ? ' [ERROR]' : ''} (${dur})`
    })
    return { success: true, output: lines.join('\n') }
  }

  const lines: string[] = []
  for (let i = 0; i < turnSpans.length; i++) {
    const turn = turnSpans[i]!
    const dur = turn.duration_ms != null ? `${(turn.duration_ms / 1000).toFixed(1)}s` : '?'

    // Find child spans of this turn
    const children = spans
      .filter((s) => s.parent_span_id === turn.id)
      .sort((a, b) => a.start_time - b.start_time)

    const childDesc = children
      .map((c) => {
        if (c.name === 'tool_exec') {
          // Try to extract tool name from attributes
          let toolName = 'unknown'
          if (c.attributes) {
            try {
              const attrs = JSON.parse(c.attributes) as Record<string, unknown>
              if (typeof attrs.tool === 'string') toolName = attrs.tool
              else if (typeof attrs.tool_name === 'string') toolName = attrs.tool_name
            } catch {
              // ignore
            }
          }
          return `tool_exec[${toolName}]`
        }
        if (c.name === 'model_call') {
          // Check if it ended with stop
          let extra = ''
          if (c.attributes) {
            try {
              const attrs = JSON.parse(c.attributes) as Record<string, unknown>
              if (attrs.finish_reason === 'stop') extra = ' (stop)'
            } catch {
              // ignore
            }
          }
          return `model_call${extra}`
        }
        return c.name
      })
      .join(' → ')

    lines.push(`Turn ${i + 1} (${dur}): ${childDesc || '(no child spans)'}`)
  }

  return { success: true, output: lines.join('\n') }
}

async function buildMessagesSection(
  job: { id: string },
  input: Record<string, unknown>
): Promise<{ success: boolean; output?: string }> {
  const offset = Math.max(typeof input.offset === 'number' ? input.offset : 0, 0)
  const limit = Math.min(Math.max(typeof input.limit === 'number' ? input.limit : 20, 1), 50)

  const allMessages = await listMessagesByJob(job.id)
  const total = allMessages.length

  if (total === 0) {
    return { success: true, output: '(No messages recorded for this run.)' }
  }

  const slice = allMessages.slice(offset, offset + limit)
  const lines: string[] = []

  for (let i = 0; i < slice.length; i++) {
    const msg = slice[i]!
    const idx = offset + i + 1
    const sender = parseSenderAttribution(msg.role, msg.content)
    const preview = formatMessagePreview(msg.role, msg.content)
    lines.push(`[${idx}/${total}] ${sender}: ${preview}`)
  }

  if (offset + limit < total) {
    lines.push(
      `(showing messages ${offset + 1}-${offset + slice.length} of ${total}, use offset=${offset + limit} for more)`
    )
  }

  return { success: true, output: lines.join('\n') }
}

async function buildStructuredRunSection(
  job: {
    id: string
    work_item_id: string
    status: string
    started_at: number | null
    completed_at: number | null
    error_text: string | null
    [key: string]: unknown
  },
  input: Record<string, unknown>
): Promise<{ success: boolean; output?: string }> {
  const messageOffset = Math.max(
    typeof input.messageOffset === 'number' ? Math.floor(input.messageOffset) : 0,
    0
  )
  const backgroundTaskOffset = Math.max(
    typeof input.backgroundTaskOffset === 'number' ? Math.floor(input.backgroundTaskOffset) : 0,
    0
  )

  const [messageTotal, backgroundTaskTotal, costs, messages, backgroundTasks] = await Promise.all([
    input.includeMessages ? countMessagesByJob(job.id) : Promise.resolve(0),
    input.includeBackgroundTasks ? countBackgroundTasksByJob(job.id) : Promise.resolve(0),
    getCostByJobs([job.id]),
    input.includeMessages
      ? listMessagesByJobPaged(job.id, {
          offset: messageOffset,
          limit: Math.min(
            Math.max(typeof input.messageLimit === 'number' ? input.messageLimit : 50, 1),
            500
          ),
        })
      : Promise.resolve(undefined),
    input.includeBackgroundTasks
      ? listBackgroundTasksByJobPaged(job.id, {
          offset: backgroundTaskOffset,
          limit: Math.min(
            Math.max(
              typeof input.backgroundTaskLimit === 'number' ? input.backgroundTaskLimit : 50,
              1
            ),
            500
          ),
        })
      : Promise.resolve(undefined),
  ])

  const includeFullMessageContent = input.includeFullMessageContent !== false
  const maxContentBytes =
    typeof input.maxContentBytes === 'number' ? Math.floor(input.maxContentBytes) : undefined
  const normalizedMessages = messages?.map((message: Awaited<
    ReturnType<typeof listMessagesByJobPaged>
  >[number]) => {
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
      const truncated = truncateMessageContent(content, maxContentBytes)
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

  const output = {
    run: job,
    cost: costs[0] ?? null,
    ...(normalizedMessages
      ? {
          messages: normalizedMessages,
          messagesPage: {
            offset: messageOffset,
            limit: Math.min(
              Math.max(typeof input.messageLimit === 'number' ? input.messageLimit : 50, 1),
              500
            ),
            returned: normalizedMessages.length,
            total: messageTotal,
            hasMore: messageOffset + normalizedMessages.length < messageTotal,
            nextOffset:
              messageOffset + normalizedMessages.length < messageTotal
                ? messageOffset + normalizedMessages.length
                : null,
          },
        }
      : {}),
    ...(backgroundTasks
      ? {
          backgroundTasks,
          backgroundTasksPage: {
            offset: backgroundTaskOffset,
            limit: Math.min(
              Math.max(
                typeof input.backgroundTaskLimit === 'number' ? input.backgroundTaskLimit : 50,
                1
              ),
              500
            ),
            returned: backgroundTasks.length,
            total: backgroundTaskTotal,
            hasMore: backgroundTaskOffset + backgroundTasks.length < backgroundTaskTotal,
            nextOffset:
              backgroundTaskOffset + backgroundTasks.length < backgroundTaskTotal
                ? backgroundTaskOffset + backgroundTasks.length
                : null,
          },
        }
      : {}),
  } as Record<string, unknown>

  if (input.includeControl === true) {
    const activity = await findActivityByJobId(job.id)
    output.activity = activity ?? null
  }

  return { success: true, output: JSON.stringify(output, null, 2) }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ATTRIBUTED_AGENT_PREFIX = /^\[@([a-z0-9._-]+)\]:\s*/i
const USER_FROM_CONTEXT_REGEX = /\[From:\s*([^\]|]+(?:\s+@[^\s\]|]+)?)\s*(?:\|[^\]]*)?\]/i

function parseSenderAttribution(role: string, content: string | null): string {
  if (!content) return role

  let text = content
  try {
    const parsed: unknown = JSON.parse(content)
    if (typeof parsed === 'string') {
      text = parsed
    } else if (Array.isArray(parsed)) {
      const first = (parsed as unknown[]).find(
        (b) => b && typeof b === 'object' && 'text' in (b as Record<string, unknown>)
      ) as Record<string, unknown> | undefined
      if (first && typeof first.text === 'string') text = first.text
    }
  } catch {
    // use raw
  }

  if (role === 'assistant') {
    const agentMatch = text.match(ATTRIBUTED_AGENT_PREFIX)
    if (agentMatch?.[1]) return `@${agentMatch[1].toLowerCase()}`
  }

  if (role === 'user') {
    const fromMatch = text.match(USER_FROM_CONTEXT_REGEX)
    if (fromMatch?.[1]) return fromMatch[1].trim()
  }

  return role
}

function formatMessagePreview(role: string, content: string | null): string {
  if (!content) return '(empty)'

  let text = content
  try {
    const parsed: unknown = JSON.parse(content)
    if (typeof parsed === 'string') {
      text = parsed
    } else if (Array.isArray(parsed)) {
      // Content blocks
      const parts: string[] = []
      for (const block of parsed as unknown[]) {
        if (block && typeof block === 'object') {
          const b = block as Record<string, unknown>
          if (typeof b.text === 'string') parts.push(b.text)
          else if (b.type === 'tool_use')
            parts.push(`[tool_call: ${typeof b.name === 'string' ? b.name : 'unknown'}]`)
          else if (b.type === 'tool_result') parts.push(`[tool_result]`)
        }
      }
      text = parts.join(' ')
    } else if (typeof parsed === 'object' && parsed !== null) {
      // Single object (tool result, etc.)
      const obj = parsed as Record<string, unknown>
      if (typeof obj.output === 'string') {
        text = obj.output
      } else {
        text = JSON.stringify(parsed)
      }
    }
  } catch {
    // use raw
  }

  // Truncate long messages
  if (text.length > 200) {
    text = text.slice(0, 200) + '...'
  }

  // Collapse newlines for compact display
  text = text.replace(/\n+/g, ' ').trim()

  return text || '(empty)'
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDuration(startedAt: number | null, completedAt: number | null): string {
  if (!startedAt || !completedAt) return '?'
  const seconds = completedAt - startedAt
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}m${secs}s`
}

function truncateMessageContent(input: string, maxBytes: number) {
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

  return { text: input.slice(0, end), truncated: true }
}

// Convenience exports
export const runHistoryDefinitions: Anthropic.Tool[] = [listRunsDefinition, getRunDefinition]
