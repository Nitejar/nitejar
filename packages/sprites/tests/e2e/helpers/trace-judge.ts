export interface SlackTraceAssertion {
  jobId: string
  workItemId: string
  expectedTools: string[]
  maxRepeatedToolErrorWarnThreshold: number
  expectedQueueMode: 'steer' | 'collect' | 'followup'
  expectedFinalStatus: 'COMPLETED' | 'FAILED' | 'CANCELLED'
  expectedReplyPattern?: RegExp
  expectedChannelId?: string
  requireAllExpectedTools?: boolean
}

export interface TraceReceipt {
  kind: 'job' | 'work_item' | 'dispatch' | 'inference_call' | 'span' | 'message' | 'queue_message'
  id: string
  note: string
}

export interface TraceJudgeResult {
  pass: boolean
  warnings: string[]
  failures: string[]
  receipts: TraceReceipt[]
}

export interface TraceInferenceCall {
  id: string
  turn: number
  finish_reason: string | null
  tool_call_names: string | null
  prompt_tokens: number
}

export interface TraceSpan {
  id: string
  name: string
  status: string
  attributes: string | null
}

export interface TraceMessage {
  id: string
  role: string
  content: string | null
}

export interface TraceQueueMessage {
  id: string
  status: string
  dispatch_id: string | null
  drop_reason: string | null
  text: string
}

export interface SlackTraceBundle {
  job: {
    id: string
    status: string
    error_text: string | null
  }
  workItem: {
    id: string
    source_ref: string
  }
  queueMode: string | null
  inferenceCalls: TraceInferenceCall[]
  spans: TraceSpan[]
  messages: TraceMessage[]
  queueMessages: TraceQueueMessage[]
  dispatch: {
    id: string
    control_reason: string | null
    status: string
    queue_key: string
    started_at: number | null
    finished_at: number | null
  } | null
}

interface ToolErrorGroup {
  key: string
  toolName: string
  error: string
  count: number
  spanIds: string[]
}

function parseJsonObject(input: string | null): Record<string, unknown> | null {
  if (!input) return null
  try {
    const parsed = JSON.parse(input) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function parseToolCallNames(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    return []
  }
}

function extractMessageText(message: TraceMessage): string {
  const parsed = parseJsonObject(message.content)
  if (!parsed) return message.content ?? ''

  const text = parsed.text
  if (typeof text === 'string') return text

  const content = parsed.content
  if (typeof content === 'string') return content

  const toolContent = parsed.output
  if (typeof toolContent === 'string') return toolContent

  return message.content ?? ''
}

function extractFinalAssistantText(messages: TraceMessage[]): string {
  const assistantMessages = messages.filter((message) => message.role === 'assistant')
  for (let i = assistantMessages.length - 1; i >= 0; i--) {
    const text = extractMessageText(assistantMessages[i]!).trim()
    if (text.length > 0) return text
  }
  return ''
}

function extractAssistantTexts(messages: TraceMessage[]): string[] {
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message) => extractMessageText(message).trim())
    .filter((text) => text.length > 0)
}

function collectCalledTools(inferenceCalls: TraceInferenceCall[]): string[] {
  const names = new Set<string>()
  for (const call of inferenceCalls) {
    for (const name of parseToolCallNames(call.tool_call_names)) {
      names.add(name)
    }
  }
  return [...names]
}

function collectToolErrorGroups(spans: TraceSpan[]): ToolErrorGroup[] {
  const groups = new Map<string, ToolErrorGroup>()

  for (const span of spans) {
    if (span.name !== 'tool_exec' || span.status !== 'error') continue

    const attributes = parseJsonObject(span.attributes)
    const toolName =
      typeof attributes?.tool_name === 'string' && attributes.tool_name.trim().length > 0
        ? attributes.tool_name
        : 'unknown_tool'
    const error =
      typeof attributes?.error === 'string' && attributes.error.trim().length > 0
        ? attributes.error
        : 'unknown_error'

    const key = `${toolName}::${error}`
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      existing.spanIds.push(span.id)
      continue
    }

    groups.set(key, {
      key,
      toolName,
      error,
      count: 1,
      spanIds: [span.id],
    })
  }

  return [...groups.values()].sort((left, right) => right.count - left.count)
}

function hasLikelyToolLoop(
  inferenceCalls: TraceInferenceCall[],
  toolErrors: ToolErrorGroup[],
  threshold: number
): { detected: boolean; reason?: string; receiptIds: string[] } {
  const repeatedByTool = new Map<string, number>()
  for (const group of toolErrors) {
    repeatedByTool.set(
      group.toolName,
      Math.max(repeatedByTool.get(group.toolName) ?? 0, group.count)
    )
  }

  const toolTurns = inferenceCalls
    .map((call) => ({
      id: call.id,
      promptTokens: call.prompt_tokens,
      tools: parseToolCallNames(call.tool_call_names),
      finishReason: call.finish_reason,
    }))
    .filter((entry) => entry.finishReason === 'tool_calls' && entry.tools.length === 1)

  const receiptIds: string[] = []

  let streakTool = ''
  let streakCount = 0
  let lastPromptTokens = -1
  let growingPromptStreak = true

  for (const turn of toolTurns) {
    const toolName = turn.tools[0]!
    if (toolName === streakTool) {
      streakCount += 1
      if (lastPromptTokens >= turn.promptTokens) {
        growingPromptStreak = false
      }
    } else {
      streakTool = toolName
      streakCount = 1
      growingPromptStreak = true
    }

    lastPromptTokens = turn.promptTokens
    receiptIds.push(turn.id)

    const repeatedToolErrors = repeatedByTool.get(toolName) ?? 0
    if (
      streakCount >= threshold + 3 &&
      repeatedToolErrors >= threshold + 2 &&
      growingPromptStreak
    ) {
      return {
        detected: true,
        reason: `Likely blind retry loop on ${toolName} (${streakCount} consecutive tool turns with growing prompt tokens).`,
        receiptIds: receiptIds.slice(-streakCount),
      }
    }
  }

  return { detected: false, receiptIds: [] }
}

function collectChannelIdsFromText(text: string): Set<string> {
  const ids = new Set<string>()
  const mentionPattern = /<#(C[A-Z0-9]{8,})(?:\|[^>]+)?>/g
  const barePattern = /\b(C[A-Z0-9]{8,})\b/g

  for (const match of text.matchAll(mentionPattern)) {
    if (match[1]) ids.add(match[1])
  }
  for (const match of text.matchAll(barePattern)) {
    if (match[1]) ids.add(match[1])
  }

  return ids
}

function collectChannelIdsFromToolMessages(messages: TraceMessage[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'tool') continue
    const text = extractMessageText(message)
    for (const channelId of collectChannelIdsFromText(text)) {
      ids.add(channelId)
    }
  }
  return ids
}

function hasToolExecutionDisabledError(bundle: SlackTraceBundle): {
  detected: boolean
  receipts: TraceReceipt[]
} {
  const receipts: TraceReceipt[] = []
  const patterns = [
    /tool execution disabled/i,
    /sprites api key not configured/i,
    /no sprites_token configured/i,
  ]

  for (const span of bundle.spans) {
    const attributes = parseJsonObject(span.attributes)
    const errorText = typeof attributes?.error === 'string' ? attributes.error : ''
    if (patterns.some((pattern) => pattern.test(errorText))) {
      receipts.push({
        kind: 'span',
        id: span.id,
        note: `Environment/tooling issue: ${errorText}`,
      })
    }
  }

  for (const message of bundle.messages) {
    if (message.role !== 'tool') continue
    const text = extractMessageText(message)
    if (patterns.some((pattern) => pattern.test(text))) {
      receipts.push({
        kind: 'message',
        id: message.id,
        note: `Tool message indicates execution disabled: ${text.slice(0, 140)}`,
      })
    }
  }

  return { detected: receipts.length > 0, receipts }
}

export function judgeSlackTrace(
  bundle: SlackTraceBundle,
  assertion: SlackTraceAssertion
): TraceJudgeResult {
  const failures: string[] = []
  const warnings: string[] = []
  const receipts: TraceReceipt[] = [
    { kind: 'job', id: bundle.job.id, note: `status=${bundle.job.status}` },
    { kind: 'work_item', id: bundle.workItem.id, note: `source_ref=${bundle.workItem.source_ref}` },
  ]

  if (bundle.dispatch) {
    receipts.push({
      kind: 'dispatch',
      id: bundle.dispatch.id,
      note: `status=${bundle.dispatch.status} control_reason=${bundle.dispatch.control_reason ?? 'none'}`,
    })
  }

  if (bundle.job.status !== assertion.expectedFinalStatus) {
    failures.push(
      `Expected job status ${assertion.expectedFinalStatus}, got ${bundle.job.status}${bundle.job.error_text ? ` (${bundle.job.error_text})` : ''}.`
    )
  }

  if ((bundle.queueMode ?? 'steer') !== assertion.expectedQueueMode) {
    failures.push(
      `Expected queue mode ${assertion.expectedQueueMode}, got ${bundle.queueMode ?? 'unknown'}.`
    )
  }

  const calledTools = collectCalledTools(bundle.inferenceCalls)
  const calledToolsSet = new Set(calledTools)
  const expectedToolsPresent = assertion.expectedTools.filter((tool) => calledToolsSet.has(tool))

  if (assertion.expectedTools.length > 0) {
    if (assertion.requireAllExpectedTools) {
      const missing = assertion.expectedTools.filter((tool) => !calledToolsSet.has(tool))
      if (missing.length > 0) {
        failures.push(`Missing expected tools: ${missing.join(', ')}`)
      }
    } else if (expectedToolsPresent.length === 0) {
      failures.push(
        `Expected at least one of [${assertion.expectedTools.join(', ')}], got [${calledTools.join(', ')}].`
      )
    }
  }

  const disallowedWriteTools = calledTools.filter((tool) => tool === 'slack_post_message')
  if (disallowedWriteTools.length > 0) {
    failures.push(
      'Detected disallowed Slack write tool calls (slack_post_message) in inference trace.'
    )
    for (const call of bundle.inferenceCalls) {
      const names = parseToolCallNames(call.tool_call_names)
      if (names.includes('slack_post_message')) {
        receipts.push({
          kind: 'inference_call',
          id: call.id,
          note: `turn=${call.turn} tool=slack_post_message`,
        })
      }
    }
  }

  const toolErrorGroups = collectToolErrorGroups(bundle.spans)
  for (const group of toolErrorGroups) {
    if (group.count <= assertion.maxRepeatedToolErrorWarnThreshold) continue

    warnings.push(
      `Repeated tool error (> ${assertion.maxRepeatedToolErrorWarnThreshold}) for ${group.toolName}: ${group.count}x (${group.error}).`
    )

    for (const spanId of group.spanIds) {
      receipts.push({
        kind: 'span',
        id: spanId,
        note: `tool_error tool=${group.toolName} count=${group.count}`,
      })
    }
  }

  const likelyLoop = hasLikelyToolLoop(
    bundle.inferenceCalls,
    toolErrorGroups,
    assertion.maxRepeatedToolErrorWarnThreshold
  )
  if (likelyLoop.detected) {
    failures.push(likelyLoop.reason ?? 'Likely blind tool retry loop detected.')
    for (const inferenceCallId of likelyLoop.receiptIds) {
      receipts.push({
        kind: 'inference_call',
        id: inferenceCallId,
        note: 'inference turn in suspected loop',
      })
    }
  }

  const finalAssistantText = extractFinalAssistantText(bundle.messages)
  const assistantTexts = extractAssistantTexts(bundle.messages)
  const expectedPattern = assertion.expectedReplyPattern
  const matchedAssistantText = expectedPattern
    ? assistantTexts.find((text) => expectedPattern.test(text))
    : undefined

  if (expectedPattern && !matchedAssistantText) {
    failures.push(`No assistant reply matched expected pattern ${expectedPattern}.`)
    const lastAssistant = [...bundle.messages]
      .reverse()
      .find((message) => message.role === 'assistant')
    if (lastAssistant) {
      receipts.push({
        kind: 'message',
        id: lastAssistant.id,
        note: `final_assistant=${extractMessageText(lastAssistant).slice(0, 180)}`,
      })
    }
  }

  if (assertion.expectedChannelId) {
    const allowed = collectChannelIdsFromToolMessages(bundle.messages)
    allowed.add(assertion.expectedChannelId)

    const channelValidationText = matchedAssistantText ?? finalAssistantText
    const foundChannelIds = collectChannelIdsFromText(channelValidationText)
    const unknown = [...foundChannelIds].filter((channelId) => !allowed.has(channelId))
    if (unknown.length > 0) {
      failures.push(`Assistant reply references unexpected channel IDs: ${unknown.join(', ')}`)
    }
  }

  const envMisconfig = hasToolExecutionDisabledError(bundle)
  if (envMisconfig.detected) {
    warnings.push('Detected environment/tool-execution misconfiguration receipts in this trace.')
    receipts.push(...envMisconfig.receipts)
  }

  return {
    pass: failures.length === 0,
    failures,
    warnings,
    receipts,
  }
}

export function formatTraceJudgeResult(result: TraceJudgeResult): string {
  const lines: string[] = []

  lines.push(result.pass ? 'PASS' : 'FAIL')

  if (result.failures.length > 0) {
    lines.push('Failures:')
    for (const failure of result.failures) {
      lines.push(`- ${failure}`)
    }
  }

  if (result.warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`)
    }
  }

  if (result.receipts.length > 0) {
    lines.push('Receipts:')
    for (const receipt of result.receipts) {
      lines.push(`- [${receipt.kind}] ${receipt.id} :: ${receipt.note}`)
    }
  }

  return lines.join('\n')
}
