'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import {
  IconClock,
  IconArrowIteration,
  IconTool,
  IconBrain,
  IconActivity,
  IconRefresh,
  IconAlertTriangle,
  IconCircleCheck,
  IconPointFilled,
  IconPhoto,
  IconFile,
  IconMusic,
  IconVideo,
  IconMicrophone,
  IconPaperclip,
  IconHistory,
  IconTerminal2,
} from '@tabler/icons-react'
import { cn, formatCost } from '@/lib/utils'
import { trpc } from '@/lib/trpc'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Span {
  id: string
  trace_id: string
  parent_span_id: string | null
  name: string
  kind: string
  status: string
  start_time: number
  end_time: number | null
  duration_ms: number | null
  attributes: string | null
  job_id: string
  agent_id: string
}

interface Message {
  id: string
  role: string
  content: string | null
  created_at: number
}

interface ExternalApiCallInfo {
  id: string
  provider: string
  operation: string
  tool_call_id: string | null
  media_artifact_id: string | null
  pricing_status: string
  pricing_source: string | null
  cost_usd: number | null
  credits_used: number | null
  duration_ms: number | null
  created_at: number
}

interface TraceMediaArtifactInfo {
  id: string
  artifact_type: string
  operation: string
  file_name: string | null
  mime_type: string | null
  file_path: string | null
  created_at: number
}

interface InferenceCallReceipt {
  id: string
  turn: number
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_usd: number | null
  finish_reason: string | null
  is_fallback: number
  duration_ms: number | null
  created_at: number
  request_payload_hash: string | null
  response_payload_hash: string | null
  attempt_kind: string | null
  attempt_index: number | null
  payload_state: string | null
  model_span_id: string | null
  request_payload_json: string | null
  request_payload_metadata_json: string | null
  request_payload_byte_size: number | null
  response_payload_json: string | null
  response_payload_metadata_json: string | null
  response_payload_byte_size: number | null
}

interface ModelInfo {
  externalId: string
  name: string
  contextLength: number | null
  modalities: string[]
  pricing: { prompt?: number | null; completion?: number | null } | null
  supportsTools: boolean
}

interface PromptHistoryMessage {
  role: string
  content?:
    | string
    | Array<{ type: string; text?: string; image_url?: { url: string }; refusal?: string }>
    | null
    | undefined
  tool_call_id?: string
  tool_calls?: ParsedToolCall[]
}

interface PromptSessionHistory {
  messages: PromptHistoryMessage[]
  totalTokens: number
  turnCount: number
  truncated: boolean
}

interface AgentIdentityByHandleEntry {
  name: string
  emoji?: string | null
}

type AgentIdentityByHandle = Record<string, AgentIdentityByHandleEntry>

interface BackgroundTaskInfo {
  id: string
  label: string | null
  command: string
  status: string
  exit_code: number | null
  error_text: string | null
  output_tail: string | null
  sprite_session_id: string
  started_at: number
  finished_at: number | null
}

interface SiblingMessage extends Message {
  agentName: string
  agentEmoji?: string | null
}

interface TraceViewProps {
  spans: Span[]
  messages: Message[]
  inferenceCalls?: InferenceCallReceipt[]
  runStatus?: string
  sessionHistory?: PromptSessionHistory
  siblingMessages?: SiblingMessage[]
  agentByHandle?: AgentIdentityByHandle
  /** Label shown on assistant message boxes (e.g. "🐙 Mary") instead of "assistant" */
  agentLabel?: string
  defaultUserLabel?: string
  applyDefaultUserLabelToHistory?: boolean
  externalApiCalls?: ExternalApiCallInfo[]
  mediaArtifacts?: TraceMediaArtifactInfo[]
  modelCatalog?: ModelInfo[]
  backgroundTasks?: BackgroundTaskInfo[]
}

interface SpanNode {
  span: Span
  children: SpanNode[]
  depth: number
}

type TraceTreeMode = 'tool-first' | 'raw'

interface DisplaySpanRow {
  span: Span
  depth: number
  hasVisibleChildren: boolean
}

interface ParsedToolCall {
  id: string
  function?: { name?: string; arguments?: string }
}

interface ParsedStoredMessagePayload {
  text: string
  toolCalls: ParsedToolCall[]
  reasoningSegments: string[]
}

interface ParsedBashResult {
  stdout: string | null
  stderr: string | null
  exitCode: number | null
  durationMs: number | null
}

interface ScrollContainerRef {
  current: HTMLDivElement | null
}

// ---------------------------------------------------------------------------
// ScrollFadePanel – scrollable container with top/bottom gradient indicators
// ---------------------------------------------------------------------------

function ScrollFadePanel({
  children,
  className,
  autoScrollToBottom = false,
}: {
  children: React.ReactNode
  className?: string
  autoScrollToBottom?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)

  const updateFades = useCallback(() => {
    const el = ref.current
    if (!el) return
    setCanScrollUp(el.scrollTop > 8)
    setCanScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 8)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (autoScrollToBottom) {
      el.scrollTop = el.scrollHeight
    }
    // Delay initial check so layout is settled
    requestAnimationFrame(updateFades)
    el.addEventListener('scroll', updateFades, { passive: true })
    const ro = new ResizeObserver(() => requestAnimationFrame(updateFades))
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateFades)
      ro.disconnect()
    }
  }, [updateFades, autoScrollToBottom])

  return (
    <div ref={ref} className={cn('overflow-y-auto', className)}>
      <div
        className={cn(
          'pointer-events-none sticky top-0 z-10 -mb-6 h-6 bg-gradient-to-b from-[#09090b] to-transparent transition-opacity duration-150',
          canScrollUp ? 'opacity-100' : 'opacity-0'
        )}
      />
      {children}
      <div
        className={cn(
          'pointer-events-none sticky bottom-0 z-10 -mt-6 h-6 bg-gradient-to-t from-[#09090b] to-transparent transition-opacity duration-150',
          canScrollDown ? 'opacity-100' : 'opacity-0'
        )}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const kindColors: Record<string, string> = {
  lifecycle: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  inference: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  tool: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  internal: 'bg-zinc-600/20 text-zinc-500 border-zinc-600/30',
}

const kindBarColors: Record<string, string> = {
  lifecycle: 'bg-zinc-500/40',
  inference: 'bg-blue-500/50',
  tool: 'bg-amber-500/50',
  internal: 'bg-zinc-600/40',
}

const spanIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  job: IconActivity,
  turn: IconArrowIteration,
  model_call: IconBrain,
  passive_memory_extract: IconBrain,
  tool_batch: IconTool,
  tool_exec: IconTool,
  session_retry: IconRefresh,
}

const BACKGROUND_TASK_TOOL_NAMES = new Set([
  'start_background_task',
  'check_background_task',
  'stop_background_task',
  'list_background_tasks',
])

const EMPTY_PROMPT_SESSION_HISTORY: PromptSessionHistory = {
  messages: [],
  totalTokens: 0,
  turnCount: 0,
  truncated: false,
}

const TOOL_FIRST_FLATTEN_SPAN_NAMES = new Set(['model_call', 'tool_batch'])
const TOOL_FIRST_KEEP_SPAN_NAMES = new Set([
  'job',
  'turn',
  'tool_exec',
  'post_process',
  'triage',
  'passive_memory_extract',
])
const PASSIVE_MEMORY_EXTRACT_TURN_BASE = 10_000
const PASSIVE_MEMORY_REFINE_TURN_BASE = 20_000

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

function buildTree(spans: Span[]): SpanNode[] {
  const nodeMap = new Map<string, SpanNode>()
  const roots: SpanNode[] = []

  for (const span of spans) {
    nodeMap.set(span.id, { span, children: [], depth: 0 })
  }

  for (const span of spans) {
    const node = nodeMap.get(span.id)!
    if (span.parent_span_id && nodeMap.has(span.parent_span_id)) {
      const parent = nodeMap.get(span.parent_span_id)!
      node.depth = parent.depth + 1
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

function buildDisplayRows(nodes: SpanNode[], mode: TraceTreeMode): DisplaySpanRow[] {
  const result: DisplaySpanRow[] = []

  function walk(list: SpanNode[], depth: number) {
    for (const node of list) {
      const flattenNode = mode === 'tool-first' && TOOL_FIRST_FLATTEN_SPAN_NAMES.has(node.span.name)
      const keepNode =
        mode === 'raw' ||
        node.span.status === 'error' ||
        TOOL_FIRST_KEEP_SPAN_NAMES.has(node.span.name)

      // Promote children upward when flattening/hiding intermediate nodes.
      if (flattenNode || !keepNode) {
        walk(node.children, depth)
        continue
      }

      const childrenStart = result.length
      walk(node.children, depth + 1)
      const childRows = result.slice(childrenStart)
      result.length = childrenStart

      // In tool-first mode, collapse a turn row when it only has one visible
      // direct child and that child is a single tool_exec.
      if (mode === 'tool-first' && node.span.name === 'turn' && node.span.status !== 'error') {
        const directChildren = childRows.filter((row) => row.depth === depth + 1)
        const singleDirectTool =
          directChildren.length === 1 && directChildren[0]?.span.name === 'tool_exec'
        if (singleDirectTool) {
          for (const row of childRows) {
            result.push({ ...row, depth: Math.max(depth, row.depth - 1) })
          }
          continue
        }
      }

      const hasVisibleChildren = childRows.some((row) => row.depth === depth + 1)
      result.push({
        span: node.span,
        depth,
        hasVisibleChildren,
      })
      result.push(...childRows)
    }
  }

  walk(nodes, 0)
  return result
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number | null, runActive: boolean): string {
  if (ms === null) return runActive ? 'in-flight' : 'interrupted'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function formatTimestamp(epoch: number): string {
  // Spans are expected in epoch milliseconds; normalize if seconds sneak in.
  const epochMs = epoch < 1_000_000_000_000 ? epoch * 1000 : epoch
  return new Date(epochMs).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  })
}

function parseAttributes(attr: string | null): Record<string, unknown> {
  if (!attr) return {}
  try {
    return JSON.parse(attr) as Record<string, unknown>
  } catch {
    return {}
  }
}

function parseToolResultDisplay(message: Message | null): string {
  if (!message?.content) return ''
  try {
    const parsed = JSON.parse(message.content) as { content?: string }
    return typeof parsed.content === 'string' ? parsed.content : message.content
  } catch {
    return message.content
  }
}

const MEDIA_TOOL_OPERATION_BY_TOOL_NAME: Record<string, string> = {
  generate_image: 'generate_image',
  transcribe_audio: 'transcribe',
  synthesize_speech: 'synthesize_speech',
}

function extractMediaPathFromToolResult(message: Message | null): string | null {
  const display = parseToolResultDisplay(message)
  if (!display) return null
  const match = display.match(/\/tmp\/media\/[^\s)]+/i)
  return match?.[0] ?? null
}

const MODEL_SPAN_ATTEMPT_KINDS = new Set([
  'primary',
  'no_tools_fallback',
  'image_fallback',
  'image_no_tools_fallback',
])

function formatAttemptKindLabel(kind: string | null): string {
  if (!kind) return 'attempt'
  return kind.replace(/_/g, ' ')
}

function formatPayloadJson(value: string | null): string | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return JSON.stringify(parsed, null, 2)
  } catch {
    return value
  }
}

function parseStoredMessagePayload(content: string | null): ParsedStoredMessagePayload {
  if (!content) {
    return { text: '', toolCalls: [], reasoningSegments: [] }
  }

  try {
    const parsed = JSON.parse(content) as {
      text?: unknown
      content?: unknown
      tool_calls?: unknown
      reasoning_segments?: unknown
    }

    const text =
      typeof parsed.text === 'string'
        ? parsed.text
        : typeof parsed.content === 'string'
          ? parsed.content
          : ''
    const toolCalls = Array.isArray(parsed.tool_calls)
      ? (parsed.tool_calls as ParsedToolCall[])
      : []
    const reasoningSegments = Array.isArray(parsed.reasoning_segments)
      ? parsed.reasoning_segments
          .filter((segment): segment is string => typeof segment === 'string')
          .map((segment) => segment.trim())
          .filter(Boolean)
      : []
    return { text, toolCalls, reasoningSegments }
  } catch {
    return { text: content, toolCalls: [], reasoningSegments: [] }
  }
}

function spanLabel(span: Span): string {
  if (span.name === 'tool_exec') {
    const attrs = parseAttributes(span.attributes)
    const toolName = attrs.tool_name as string | undefined
    if (toolName) return toolName
  }
  return span.name.replace(/_/g, ' ')
}

function formatContextLength(len: number): string {
  if (len >= 1_000_000) return `${(len / 1_000_000).toFixed(1)}M context`
  if (len >= 1_000) return `${Math.round(len / 1_000)}k context`
  return `${len} context`
}

function formatPricePerMillion(perToken: number): string {
  const perMillion = perToken * 1_000_000
  return perMillion < 0.01 ? '<$0.01' : `$${perMillion.toFixed(2)}`
}

function ModelTooltipContent({ info }: { info: ModelInfo }) {
  return (
    <div className="space-y-1.5 text-xs">
      <div className="font-semibold">{info.name}</div>
      <div className="space-y-0.5 text-[10px]">
        {info.contextLength != null && <div>{formatContextLength(info.contextLength)}</div>}
        {info.modalities.length > 0 && <div>Modalities: {info.modalities.join(', ')}</div>}
        <div>Tool use: {info.supportsTools ? 'yes' : 'no'}</div>
        {info.pricing && (
          <table className="mt-1 border-t border-white/10 pt-1 tabular-nums">
            <tbody>
              {info.pricing.prompt != null && (
                <tr>
                  <td className="pr-2">Prompt</td>
                  <td className="text-right">{formatPricePerMillion(info.pricing.prompt)}</td>
                  <td className="pl-1">/1M tokens</td>
                </tr>
              )}
              {info.pricing.completion != null && (
                <tr>
                  <td className="pr-2">Completion</td>
                  <td className="text-right">{formatPricePerMillion(info.pricing.completion)}</td>
                  <td className="pl-1">/1M tokens</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Message correlation helpers — uses span hierarchy, not time windows
// ---------------------------------------------------------------------------

/** Recursively collect all tool_call_ids from descendant tool_exec spans. */
function getDescendantToolCallIds(spanId: string, allSpans: Span[]): string[] {
  const ids: string[] = []
  for (const child of allSpans.filter((s) => s.parent_span_id === spanId)) {
    if (child.name === 'tool_exec') {
      const attrs = parseAttributes(child.attributes)
      if (attrs.tool_call_id) ids.push(attrs.tool_call_id as string)
    }
    ids.push(...getDescendantToolCallIds(child.id, allSpans))
  }
  return ids
}

/** Find the assistant message whose tool_calls array contains any of the given IDs. */
function findAssistantMessageByToolCallIds(
  toolCallIds: string[],
  messages: Message[]
): Message | null {
  if (toolCallIds.length === 0) return null
  const idSet = new Set(toolCallIds)
  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.content) continue
    try {
      const parsed = JSON.parse(msg.content) as { tool_calls?: ParsedToolCall[] }
      if (Array.isArray(parsed.tool_calls)) {
        if (parsed.tool_calls.some((tc) => tc.id && idSet.has(tc.id))) {
          return msg
        }
      }
    } catch {
      /* not JSON */
    }
  }
  return null
}

/** Find tool result messages matching specific tool_call_ids. */
function findToolResultsByIds(toolCallIds: string[], messages: Message[]): Message[] {
  if (toolCallIds.length === 0) return []
  const idSet = new Set(toolCallIds)
  return messages.filter((msg) => {
    if (msg.role !== 'tool' || !msg.content) return false
    try {
      const parsed = JSON.parse(msg.content) as { tool_call_id?: string }
      return parsed.tool_call_id ? idSet.has(parsed.tool_call_id) : false
    } catch {
      return false
    }
  })
}

/**
 * For a turn span, find the assistant message that triggered tool calls (if any)
 * and any text-only assistant message (for turns that end with stop).
 */
function getTurnAssistantMessage(
  turnSpan: Span,
  allSpans: Span[],
  messages: Message[]
): Message | null {
  // First, try exact match via tool_call_ids
  const toolCallIds = getDescendantToolCallIds(turnSpan.id, allSpans)
  if (toolCallIds.length > 0) {
    return findAssistantMessageByToolCallIds(toolCallIds, messages)
  }

  // For text-only turns (no tool calls), find assistant messages by exclusion:
  // collect all tool_call_ids from ALL spans, then find assistant messages NOT matching any.
  // Use timestamp ordering to pick the right one.
  const allToolCallIds = new Set(
    allSpans
      .filter((s) => s.name === 'tool_exec')
      .map((s) => {
        const a = parseAttributes(s.attributes)
        return a.tool_call_id as string | undefined
      })
      .filter(Boolean) as string[]
  )

  // Find assistant messages that don't have tool_calls (text-only responses)
  // and fall within this turn's time window (tight, no buffer)
  const startSec = Math.floor(turnSpan.start_time / 1000)
  const endSec = turnSpan.end_time ? Math.ceil(turnSpan.end_time / 1000) + 1 : Infinity

  const candidates = messages.filter((m) => {
    if (m.role !== 'assistant' || !m.content) return false
    if (m.created_at < startSec || m.created_at > endSec) return false
    try {
      const parsed = JSON.parse(m.content) as { tool_calls?: ParsedToolCall[] }
      // Accept messages with no tool_calls, or tool_calls that aren't claimed by other turns
      if (!Array.isArray(parsed.tool_calls) || parsed.tool_calls.length === 0) return true
      // Check if these tool_calls belong to a different turn
      return parsed.tool_calls.every((tc) => !tc.id || !allToolCallIds.has(tc.id))
    } catch {
      // Not JSON — it's a plain text assistant message
      return true
    }
  })

  return candidates[0] ?? null
}

/** For a single tool_exec span, find the tool call and result messages. */
function getToolExecMessages(
  span: Span,
  messages: Message[]
): { callMsg: Message | null; resultMsg: Message | null } {
  const attrs = parseAttributes(span.attributes)
  const toolCallId = attrs.tool_call_id as string | undefined
  if (!toolCallId) return { callMsg: null, resultMsg: null }

  let callMsg: Message | null = null
  let resultMsg: Message | null = null

  for (const msg of messages) {
    if (!msg.content) continue
    try {
      const parsed = JSON.parse(msg.content) as {
        tool_call_id?: string
        tool_calls?: ParsedToolCall[]
      }
      if (msg.role === 'tool' && parsed.tool_call_id === toolCallId) {
        resultMsg = msg
      }
      if (msg.role === 'assistant' && Array.isArray(parsed.tool_calls)) {
        if (parsed.tool_calls.some((t) => t.id === toolCallId)) {
          callMsg = msg
        }
      }
    } catch {
      /* not JSON */
    }
  }

  return { callMsg, resultMsg }
}

function getToolResultCallId(message: Message): string | null {
  if (message.role !== 'tool' || !message.content) return null
  try {
    const parsed = JSON.parse(message.content) as { tool_call_id?: string }
    return parsed.tool_call_id ?? null
  } catch {
    return null
  }
}

function buildToolCallNameMap(spans: Span[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const span of spans) {
    if (span.name !== 'tool_exec') continue
    const attrs = parseAttributes(span.attributes)
    const tcId = typeof attrs.tool_call_id === 'string' ? attrs.tool_call_id : null
    const toolName = typeof attrs.tool_name === 'string' ? attrs.tool_name : null
    if (tcId && toolName) {
      map.set(tcId, toolName)
    }
  }
  return map
}

function getAssistantToolCalls(message: Message): ParsedToolCall[] {
  if (message.role !== 'assistant' || !message.content) return []
  return parseStoredMessagePayload(message.content).toolCalls
}

type AgentResponseBlock =
  | { kind: 'single'; message: Message }
  | { kind: 'assistant-tool-exchange'; assistant: Message; toolResults: Message[] }

function buildAgentResponseBlocks(messages: Message[]): AgentResponseBlock[] {
  const blocks: AgentResponseBlock[] = []

  for (let i = 0; i < messages.length; i++) {
    const current = messages[i]!
    if (current.role !== 'assistant') {
      blocks.push({ kind: 'single', message: current })
      continue
    }

    const toolCalls = getAssistantToolCalls(current)
    const callIds = toolCalls.map((tc) => tc.id).filter((id): id is string => Boolean(id))
    if (callIds.length === 0) {
      blocks.push({ kind: 'single', message: current })
      continue
    }

    const idSet = new Set(callIds)
    const toolResults: Message[] = []
    let cursor = i + 1
    while (cursor < messages.length) {
      const next = messages[cursor]!
      if (next.role !== 'tool') break
      const tcId = getToolResultCallId(next)
      if (!tcId || !idSet.has(tcId)) break
      toolResults.push(next)
      cursor += 1
    }

    if (toolResults.length === 0) {
      blocks.push({ kind: 'single', message: current })
      continue
    }

    blocks.push({ kind: 'assistant-tool-exchange', assistant: current, toolResults })
    i = cursor - 1
  }

  return blocks
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

interface ContentPart {
  type: string
  text?: string
  image_url?: { url: string }
}

/** Extract image data URLs from a message's content_parts. */
function extractImageUrls(message: Message): string[] {
  if (!message.content) return []
  try {
    const parsed = JSON.parse(message.content) as { content_parts?: ContentPart[] }
    if (!Array.isArray(parsed.content_parts)) return []
    return parsed.content_parts
      .filter((p) => p.type === 'image_url' && p.image_url?.url)
      .map((p) => p.image_url!.url)
  } catch {
    return []
  }
}

/** Check if a user message has attachment metadata (non-image). */
function hasAttachmentMetadata(message: Message): boolean {
  if (message.role !== 'user' || !message.content) return false
  try {
    const parsed = JSON.parse(message.content) as { text?: string }
    const text = parsed.text ?? message.content
    return /^Attachment \d+: .+$/m.test(text)
  } catch {
    return /^Attachment \d+: .+$/m.test(message.content)
  }
}

/** Find span IDs that should show an attachment indicator (job span + first turn). */
function getSpanIdsWithAttachments(
  messages: Message[],
  spans: Span[]
): { ids: Set<string>; hasImages: boolean; hasOtherAttachments: boolean } {
  const ids = new Set<string>()
  const hasImages = messages.some((m) => m.role === 'user' && extractImageUrls(m).length > 0)
  const hasOtherAttachments = messages.some((m) => hasAttachmentMetadata(m))
  if (!hasImages && !hasOtherAttachments) return { ids, hasImages, hasOtherAttachments }

  for (const span of spans) {
    if (span.name === 'job') {
      ids.add(span.id)
    }
    if (span.name === 'turn') {
      const attrs = parseAttributes(span.attributes)
      if (attrs.turn_number === 1) {
        ids.add(span.id)
      }
    }
  }
  return { ids, hasImages, hasOtherAttachments }
}

/** Render a row of clickable image thumbnails that open in a modal overlay. */
function ImageGallery({ images }: { images: string[] }) {
  const [modalIdx, setModalIdx] = useState<number | null>(null)

  if (images.length === 0) return null

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {images.map((url, i) => (
          <button
            key={i}
            onClick={() => setModalIdx(i)}
            className="overflow-hidden rounded-md border border-white/10 transition-colors hover:border-white/25"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Image ${i + 1}`} className="h-20 w-auto object-cover" />
          </button>
        ))}
      </div>
      {modalIdx !== null && (
        <ImageModal images={images} initialIndex={modalIdx} onClose={() => setModalIdx(null)} />
      )}
    </>
  )
}

/** Full-screen modal overlay for viewing images. */
function ImageModal({
  images,
  initialIndex,
  onClose,
}: {
  images: string[]
  initialIndex: number
  onClose: () => void
}) {
  const [currentIdx, setCurrentIdx] = useState(initialIndex)
  const hasMultiple = images.length > 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] max-w-[90vw] flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -right-2 -top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-sm text-white/70 shadow-lg transition-colors hover:bg-zinc-700 hover:text-white"
        >
          &times;
        </button>

        {/* Image */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[currentIdx]}
          alt={`Image ${currentIdx + 1}`}
          className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain"
        />

        {/* Navigation */}
        {hasMultiple && (
          <div className="mt-3 flex items-center gap-4">
            <button
              onClick={() => setCurrentIdx((currentIdx - 1 + images.length) % images.length)}
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-zinc-700 hover:text-white"
            >
              Prev
            </button>
            <span className="text-xs text-white/50">
              {currentIdx + 1} / {images.length}
            </span>
            <button
              onClick={() => setCurrentIdx((currentIdx + 1) % images.length)}
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-zinc-700 hover:text-white"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Left Panel: Span Tree
// ---------------------------------------------------------------------------

function SpanTreeRow({
  node,
  timelineStart,
  timelineRange,
  runActive,
  selectedId,
  onSelect,
  modelCatalog = [],
  hasAttachments = false,
  attachmentIcon: AttachmentIcon,
}: {
  node: DisplaySpanRow
  timelineStart: number
  timelineRange: number
  runActive: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  modelCatalog?: ModelInfo[]
  hasAttachments?: boolean
  attachmentIcon?: React.ComponentType<{ className?: string }>
}) {
  const { span } = node
  const isError = span.status === 'error'
  const isSelected = selectedId === span.id
  const offsetPct = ((span.start_time - timelineStart) / timelineRange) * 100
  const widthPct = span.duration_ms ? (span.duration_ms / timelineRange) * 100 : 0.5

  // Detect background task tool_exec spans for distinct styling
  const toolName =
    span.name === 'tool_exec' ? ((parseAttributes(span.attributes).tool_name as string) ?? '') : ''
  const isBgTaskTool = BACKGROUND_TASK_TOOL_NAMES.has(toolName)
  const Icon = isBgTaskTool ? IconTerminal2 : spanIcons[span.name] || IconActivity

  // For model_call spans, show the model display name from catalog
  let label = spanLabel(span)
  if (isBgTaskTool) {
    label = toolName.replace(/^(start|check|stop|list)_background_task$/, '$1 bg task')
  } else if (span.name === 'model_call') {
    const attrs = parseAttributes(span.attributes)
    const modelId = attrs.model as string | undefined
    if (modelId) {
      const info = modelCatalog.find((m) => m.externalId === modelId)
      label = info?.name ?? modelId.split('/').pop() ?? label
    }
  }

  return (
    <button
      onClick={() => onSelect(span.id)}
      className={cn(
        'group flex w-full items-center gap-1.5 px-1 py-1 text-left text-[11px] transition-colors',
        isSelected
          ? 'bg-white/[0.07] text-foreground'
          : 'text-muted-foreground hover:bg-white/[0.03] hover:text-foreground',
        isError && !isSelected && 'text-red-400/80'
      )}
      style={{ paddingLeft: `${node.depth * 16 + 4}px` }}
    >
      {/* Collapse indicator for nodes with children */}
      <span className="w-3 shrink-0 text-center text-[8px] text-white/20">
        {node.hasVisibleChildren ? '▾' : ''}
      </span>

      {/* Icon */}
      <Icon
        className={cn(
          'h-3 w-3 shrink-0',
          isError
            ? 'text-red-400'
            : isBgTaskTool
              ? 'text-cyan-400/70'
              : isSelected
                ? 'text-foreground'
                : 'text-white/30'
        )}
      />

      {/* Name */}
      <span className={cn('min-w-0 truncate font-mono', isError && 'text-red-400')}>{label}</span>

      {/* Attachment indicator */}
      {hasAttachments && AttachmentIcon && (
        <AttachmentIcon className="h-3 w-3 shrink-0 text-sky-400/50" />
      )}

      {/* Spacer */}
      <span className="flex-1" />

      {/* Miniature waterfall bar */}
      <div className="relative hidden h-2.5 w-20 shrink-0 rounded-sm bg-white/[0.03] lg:block">
        <div
          className={cn(
            'absolute top-0.5 h-1.5 rounded-sm',
            isError ? 'bg-red-500/60' : kindBarColors[span.kind] || kindBarColors.internal
          )}
          style={{
            left: `${Math.max(0, Math.min(offsetPct, 100))}%`,
            width: `${Math.max(1, Math.min(widthPct, 100 - offsetPct))}%`,
          }}
        />
      </div>

      {/* Duration */}
      <Tooltip>
        <TooltipTrigger
          render={<span />}
          className={cn(
            'w-14 shrink-0 text-right tabular-nums text-[10px]',
            isError ? 'text-red-400/70' : 'text-white/30'
          )}
        >
          {formatDuration(span.duration_ms, runActive)}
        </TooltipTrigger>
        <TooltipContent side="left" className="text-[10px]">
          <div className="min-w-48 space-y-0.5">
            <div className="flex items-center justify-between gap-3 whitespace-nowrap">
              <span className="font-medium opacity-70">Started</span>
              <span className="text-right font-mono tabular-nums">
                {formatTimestamp(span.start_time)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 whitespace-nowrap">
              <span className="font-medium opacity-70">Ended</span>
              {span.end_time ? (
                <span className="text-right font-mono tabular-nums">
                  {formatTimestamp(span.end_time)}
                </span>
              ) : (
                <span className="text-right opacity-70">
                  {runActive ? 'Still running' : 'No end time'}
                </span>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Right Panel: Detail View
// ---------------------------------------------------------------------------

function DetailPanel({
  span,
  messages,
  allSpans,
  inferenceCalls = [],
  runActive,
  sessionHistory = EMPTY_PROMPT_SESSION_HISTORY,
  siblingMessages = [],
  agentByHandle = {},
  assistantLabel,
  defaultUserLabel,
  applyDefaultUserLabelToHistory = false,
  externalApiCalls = [],
  mediaArtifacts = [],
  modelCatalog = [],
  backgroundTasks = [],
}: {
  span: Span
  messages: Message[]
  allSpans: Span[]
  inferenceCalls?: InferenceCallReceipt[]
  runActive: boolean
  sessionHistory?: PromptSessionHistory
  siblingMessages?: SiblingMessage[]
  agentByHandle?: AgentIdentityByHandle
  assistantLabel?: string
  defaultUserLabel?: string
  applyDefaultUserLabelToHistory?: boolean
  externalApiCalls?: ExternalApiCallInfo[]
  mediaArtifacts?: TraceMediaArtifactInfo[]
  modelCatalog?: ModelInfo[]
  backgroundTasks?: BackgroundTaskInfo[]
}) {
  const attrs = parseAttributes(span.attributes)
  const isError = span.status === 'error'
  const childSpans = allSpans.filter((s) => s.parent_span_id === span.id)
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const bgTaskMap = buildBackgroundTaskMap(messages, backgroundTasks)
  const mediaArtifactsById = useMemo(
    () => new Map(mediaArtifacts.map((artifact) => [artifact.id, artifact])),
    [mediaArtifacts]
  )

  return (
    <div className="flex flex-col">
      {/* ---- Header ---- */}
      <DetailHeader
        span={span}
        attrs={attrs}
        isError={isError}
        runActive={runActive}
        childSpans={childSpans}
        modelCatalog={modelCatalog}
      />

      {/* ---- Body ---- */}
      <div ref={bodyScrollRef}>
        {/* Attributes (shown for all span types) */}
        <AttributesSection attrs={attrs} />

        {/* Type-specific content */}
        {span.name === 'tool_exec' && (
          <ToolExecDetail
            span={span}
            messages={messages}
            attrs={attrs}
            externalApiCalls={externalApiCalls}
            mediaArtifacts={mediaArtifacts}
            mediaArtifactsById={mediaArtifactsById}
            backgroundTaskMap={bgTaskMap}
          />
        )}
        {span.name === 'tool_batch' && (
          <ToolBatchDetail
            span={span}
            messages={messages}
            allSpans={allSpans}
            runActive={runActive}
            externalApiCalls={externalApiCalls}
            mediaArtifacts={mediaArtifacts}
            mediaArtifactsById={mediaArtifactsById}
            backgroundTaskMap={bgTaskMap}
          />
        )}
        {span.name === 'model_call' && (
          <ModelCallDetail
            span={span}
            messages={messages}
            allSpans={allSpans}
            inferenceCalls={inferenceCalls}
          />
        )}
        {span.name === 'passive_memory_extract' && (
          <PassiveMemoryDetail span={span} inferenceCalls={inferenceCalls} />
        )}
        {span.name === 'post_process' && <PostProcessDetail span={span} messages={messages} />}
        {span.name === 'turn' && (
          <TurnDetail
            span={span}
            messages={messages}
            allSpans={allSpans}
            externalApiCalls={externalApiCalls}
            mediaArtifacts={mediaArtifacts}
            mediaArtifactsById={mediaArtifactsById}
          />
        )}
        {span.name === 'job' && (
          <JobDetail
            messages={messages}
            allSpans={allSpans}
            sessionHistory={sessionHistory}
            siblingMessages={siblingMessages}
            agentByHandle={agentByHandle}
            assistantLabel={assistantLabel}
            defaultUserLabel={defaultUserLabel}
            applyDefaultUserLabelToHistory={applyDefaultUserLabelToHistory}
            externalApiCalls={externalApiCalls}
            mediaArtifacts={mediaArtifacts}
            mediaArtifactsById={mediaArtifactsById}
            scrollContainerRef={bodyScrollRef}
            backgroundTaskMap={bgTaskMap}
          />
        )}
      </div>
    </div>
  )
}

function DetailHeader({
  span,
  attrs,
  isError,
  runActive,
  childSpans,
  modelCatalog = [],
}: {
  span: Span
  attrs: Record<string, unknown>
  isError: boolean
  runActive: boolean
  childSpans: Span[]
  modelCatalog?: ModelInfo[]
}) {
  const modelId = span.name === 'model_call' ? (attrs.model as string | undefined) : undefined
  const modelInfo = modelId ? modelCatalog.find((m) => m.externalId === modelId) : undefined

  return (
    <div className="shrink-0 border-b border-white/5 px-4 py-3">
      <div className="flex items-center gap-2">
        {isError ? (
          <IconAlertTriangle className="h-4 w-4 text-red-400" />
        ) : (
          <IconCircleCheck className="h-4 w-4 text-emerald-500" />
        )}
        <h4 className="font-mono text-sm font-semibold">{spanLabel(span)}</h4>
        <span
          className={cn(
            'rounded border px-1.5 py-0.5 text-[10px] font-medium',
            kindColors[span.kind] || kindColors.internal
          )}
        >
          {span.kind}
        </span>
        {isError && (
          <span className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
            error
          </span>
        )}
      </div>
      {/* Model info row for model_call spans */}
      {modelId && (
        <div className="mt-1.5 flex items-center gap-2">
          {modelInfo ? (
            <Tooltip>
              <TooltipTrigger className="cursor-default rounded border border-blue-500/20 bg-blue-500/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-blue-400 transition-colors hover:bg-blue-500/10">
                {modelInfo.name}
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start">
                <ModelTooltipContent info={modelInfo} />
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {modelId}
            </span>
          )}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <IconClock className="h-3 w-3" />
          {formatDuration(span.duration_ms, runActive)}
        </span>
        <span>{formatTimestamp(span.start_time)}</span>
        {span.end_time && (
          <>
            <span className="text-white/20">&rarr;</span>
            <span>{formatTimestamp(span.end_time)}</span>
          </>
        )}
        {childSpans.length > 0 && (
          <span>
            {childSpans.length} child span{childSpans.length !== 1 ? 's' : ''}
          </span>
        )}
        {typeof attrs.turn_number === 'number' && <span>turn {attrs.turn_number}</span>}
      </div>
      {isError && typeof attrs.error === 'string' && (
        <div className="mt-2 rounded border border-red-500/20 bg-red-500/[0.05] px-3 py-2 text-[11px] text-red-400">
          {attrs.error}
        </div>
      )}
    </div>
  )
}

function AttributesSection({ attrs }: { attrs: Record<string, unknown> }) {
  // Filter out keys that are displayed elsewhere
  const displayKeys = Object.keys(attrs).filter(
    (k) => !['error', 'tool_call_id', 'tool_name', 'model'].includes(k)
  )
  if (displayKeys.length === 0) return null

  return (
    <div className="border-b border-white/5 px-4 py-3">
      <h5 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Attributes
      </h5>
      <div className="space-y-1">
        {displayKeys.map((key) => {
          const value = attrs[key]
          return (
            <div key={key} className="flex items-start gap-2 text-xs">
              <span className="w-32 shrink-0 truncate font-mono text-white/40">{key}</span>
              <span className="min-w-0 break-all font-mono text-foreground">
                {typeof value === 'object' || typeof value === 'symbol'
                  ? JSON.stringify(value)
                  : `${value as string | number | boolean | null | undefined}`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Type-specific detail panels
// ---------------------------------------------------------------------------

/**
 * Build a map from tool_call_id -> BackgroundTaskInfo by scanning tool result messages
 * for task_id references. This lets us show background task output inline in the
 * tool_exec detail where start_background_task was called.
 */
function buildBackgroundTaskMap(
  messages: Message[],
  backgroundTasks: BackgroundTaskInfo[]
): Map<string, BackgroundTaskInfo> {
  const map = new Map<string, BackgroundTaskInfo>()
  if (backgroundTasks.length === 0) return map

  const taskById = new Map(backgroundTasks.map((t) => [t.id, t]))

  for (const msg of messages) {
    if (msg.role !== 'tool' || !msg.content) continue
    try {
      const parsed = JSON.parse(msg.content) as { tool_call_id?: string; content?: string }
      if (!parsed.tool_call_id || !parsed.content) continue

      // start_background_task result: "task_id: <uuid>"
      const taskIdMatch = parsed.content.match(/task_id:\s*(\S+)/)
      if (taskIdMatch?.[1]) {
        const task = taskById.get(taskIdMatch[1])
        if (task) map.set(parsed.tool_call_id, task)
        continue
      }

      // check/stop result: "id=<uuid>"
      const idMatch = parsed.content.match(/id=(\S+)/)
      if (idMatch?.[1]) {
        const task = taskById.get(idMatch[1])
        if (task) map.set(parsed.tool_call_id, task)
      }
    } catch {
      /* ignore */
    }
  }

  return map
}

function BackgroundTaskInline({ task }: { task: BackgroundTaskInfo }) {
  const [expanded, setExpanded] = useState(false)

  const statusStyles =
    task.status === 'succeeded'
      ? 'border-emerald-500/20 bg-emerald-500/[0.03]'
      : task.status === 'failed'
        ? 'border-red-500/20 bg-red-500/[0.03]'
        : task.status === 'killed'
          ? 'border-amber-500/20 bg-amber-500/[0.03]'
          : 'border-sky-500/20 bg-sky-500/[0.03]'

  const statusColor =
    task.status === 'succeeded'
      ? 'text-emerald-400'
      : task.status === 'failed'
        ? 'text-red-400'
        : task.status === 'killed'
          ? 'text-amber-400'
          : 'text-sky-400'

  const hasOutput = task.output_tail && task.output_tail.trim().length > 0

  return (
    <div className={cn('rounded-md border', statusStyles)}>
      <div className="flex items-center justify-between px-3 py-1.5 text-[10px]">
        <div className="flex items-center gap-2">
          <IconTerminal2 className="h-3 w-3 text-muted-foreground" />
          <span className={cn('font-medium uppercase', statusColor)}>{task.status}</span>
          {task.label && (
            <span className="truncate font-mono text-foreground/60">{task.label}</span>
          )}
          {task.exit_code !== null && (
            <span className="text-muted-foreground">exit {task.exit_code}</span>
          )}
        </div>
        {hasOutput && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-white/30 transition-colors hover:text-white/60"
          >
            {expanded ? 'Hide output' : 'Show output'}
          </button>
        )}
      </div>
      <div className="border-t border-inherit px-3 py-1.5">
        <pre className="whitespace-pre-wrap font-mono text-[10px] text-foreground/50">
          {task.command}
        </pre>
      </div>
      {expanded && hasOutput && (
        <div className="border-t border-inherit px-3 py-2">
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-foreground/70">
            {task.output_tail}
          </pre>
        </div>
      )}
      {task.error_text && (
        <div className="border-t border-inherit px-3 py-1.5 text-[10px] text-red-400">
          {task.error_text}
        </div>
      )}
    </div>
  )
}

/**
 * Render a message, replacing background task tool results with the full
 * BackgroundTaskInline component so they stand out in the messages list.
 */
function MessageOrBackgroundTask({
  message,
  backgroundTaskMap,
  toolCallNameMap,
  externalApiCalls = [],
  mediaArtifacts = [],
  mediaArtifactsById = new Map<string, TraceMediaArtifactInfo>(),
  defaultUserLabel,
  assistantLabel,
  toolCallStatusMap,
}: {
  message: Message
  backgroundTaskMap: Map<string, BackgroundTaskInfo>
  toolCallNameMap?: Map<string, string>
  externalApiCalls?: ExternalApiCallInfo[]
  mediaArtifacts?: TraceMediaArtifactInfo[]
  mediaArtifactsById?: Map<string, TraceMediaArtifactInfo>
  defaultUserLabel?: string
  /** Label to show for assistant messages instead of "assistant" */
  assistantLabel?: string
  toolCallStatusMap?: Map<string, 'pending' | 'ok' | 'error'>
}) {
  const roleLabel = message.role === 'assistant' ? assistantLabel : undefined

  if (message.role === 'tool') {
    const toolCallId = getToolResultCallId(message)
    if (toolCallId && backgroundTaskMap.size > 0) {
      const bgTask = backgroundTaskMap.get(toolCallId)
      if (bgTask) {
        return <BackgroundTaskInline task={bgTask} />
      }
    }

    const inferredToolName =
      toolCallId && toolCallNameMap ? (toolCallNameMap.get(toolCallId) ?? undefined) : undefined
    return (
      <ToolResultCard
        message={message}
        toolName={inferredToolName}
        externalApiCalls={externalApiCalls}
        mediaArtifacts={mediaArtifacts}
        mediaArtifactsById={mediaArtifactsById}
      />
    )
  }

  // For assistant messages with background task tool calls, add a visual hint
  if (message.role === 'assistant' && message.content && backgroundTaskMap.size > 0) {
    try {
      const parsed = JSON.parse(message.content) as { tool_calls?: ParsedToolCall[] }
      if (Array.isArray(parsed.tool_calls)) {
        const hasBgToolCall = parsed.tool_calls.some(
          (tc) => tc.function?.name && BACKGROUND_TASK_TOOL_NAMES.has(tc.function.name)
        )
        if (hasBgToolCall) {
          return (
            <CompactMessage
              message={message}
              bgTaskIndicator
              defaultUserLabel={defaultUserLabel}
              roleLabel={roleLabel}
              toolCallStatusMap={toolCallStatusMap}
            />
          )
        }
      }
    } catch {
      /* not JSON */
    }
  }

  return (
    <CompactMessage
      message={message}
      defaultUserLabel={defaultUserLabel}
      roleLabel={roleLabel}
      toolCallStatusMap={toolCallStatusMap}
    />
  )
}

function AssistantToolExchange({
  assistantMessage,
  toolResultMessages,
  toolCallNameMap,
  backgroundTaskMap,
  externalApiCalls = [],
  mediaArtifacts = [],
  mediaArtifactsById = new Map<string, TraceMediaArtifactInfo>(),
  defaultUserLabel,
  assistantLabel,
  toolCallStatusMap,
}: {
  assistantMessage: Message
  toolResultMessages: Message[]
  toolCallNameMap?: Map<string, string>
  backgroundTaskMap: Map<string, BackgroundTaskInfo>
  externalApiCalls?: ExternalApiCallInfo[]
  mediaArtifacts?: TraceMediaArtifactInfo[]
  mediaArtifactsById?: Map<string, TraceMediaArtifactInfo>
  defaultUserLabel?: string
  assistantLabel?: string
  toolCallStatusMap?: Map<string, 'pending' | 'ok' | 'error'>
}) {
  return (
    <div className="overflow-hidden rounded-md border border-emerald-500/20 bg-emerald-500/[0.03]">
      <div className="border-b border-emerald-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-emerald-400">
        Tool Exchange
      </div>
      <div className="px-2 py-1.5">
        <CompactMessage
          message={assistantMessage}
          embedded
          defaultUserLabel={defaultUserLabel}
          roleLabel={assistantLabel}
          toolCallStatusMap={toolCallStatusMap}
        />
      </div>
      <div className="space-y-1 border-t border-emerald-500/10 px-2 py-1.5">
        {toolResultMessages.map((msg) => {
          const tcId = getToolResultCallId(msg)
          const toolName =
            tcId && toolCallNameMap ? (toolCallNameMap.get(tcId) ?? undefined) : undefined
          const bgTask = tcId ? backgroundTaskMap.get(tcId) : undefined
          if (bgTask) return <BackgroundTaskInline key={msg.id} task={bgTask} />
          return (
            <ToolResultCard
              key={msg.id}
              message={msg}
              toolName={toolName}
              externalApiCalls={externalApiCalls}
              mediaArtifacts={mediaArtifacts}
              mediaArtifactsById={mediaArtifactsById}
            />
          )
        })}
      </div>
    </div>
  )
}

/** tool_exec: show the specific tool call input + result */
function ToolExecDetail({
  span,
  messages,
  attrs,
  externalApiCalls = [],
  mediaArtifacts = [],
  mediaArtifactsById = new Map<string, TraceMediaArtifactInfo>(),
  backgroundTaskMap,
}: {
  span: Span
  messages: Message[]
  attrs: Record<string, unknown>
  externalApiCalls?: ExternalApiCallInfo[]
  mediaArtifacts?: TraceMediaArtifactInfo[]
  mediaArtifactsById?: Map<string, TraceMediaArtifactInfo>
  backgroundTaskMap?: Map<string, BackgroundTaskInfo>
}) {
  const { callMsg, resultMsg } = getToolExecMessages(span, messages)
  const extCost = findExternalCostForSpan(span, externalApiCalls)
  const toolCallId = attrs.tool_call_id as string | undefined
  const bgTask = toolCallId && backgroundTaskMap ? backgroundTaskMap.get(toolCallId) : null
  if (!callMsg && !resultMsg && !extCost && !bgTask) return null

  return (
    <div className="border-b border-white/5 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <h5 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Tool I/O
        </h5>
        {extCost && <ExternalCallCostBadge call={extCost} />}
      </div>
      <div className="space-y-2">
        {callMsg && <ToolCallCard message={callMsg} toolCallId={attrs.tool_call_id as string} />}
        {resultMsg && (
          <ToolResultCard
            message={resultMsg}
            toolName={attrs.tool_name as string}
            externalApiCalls={externalApiCalls}
            mediaArtifacts={mediaArtifacts}
            mediaArtifactsById={mediaArtifactsById}
          />
        )}
        {bgTask && <BackgroundTaskInline task={bgTask} />}
      </div>
    </div>
  )
}

/** Match an external API call to a tool_exec span by timing overlap. */
function findExternalCostForSpan(
  toolSpan: Span,
  externalApiCalls: ExternalApiCallInfo[]
): ExternalApiCallInfo | null {
  if (externalApiCalls.length === 0) return null
  const attrs = parseAttributes(toolSpan.attributes)
  const toolCallId = typeof attrs.tool_call_id === 'string' ? attrs.tool_call_id : null
  const toolName = typeof attrs.tool_name === 'string' ? attrs.tool_name : null

  if (toolCallId) {
    const exactMatch = externalApiCalls.find((call) => call.tool_call_id === toolCallId)
    if (exactMatch) return exactMatch
  }

  const operationAliases: Record<string, string[]> = {
    web_search: ['web_search', 'search'],
    extract_url: ['extract_url', 'extract'],
    generate_image: ['generate_image'],
    transcribe_audio: ['transcribe_audio', 'transcribe'],
    synthesize_speech: ['synthesize_speech'],
  }
  const allowedOperations = toolName ? (operationAliases[toolName] ?? []) : []

  const spanStartSec = Math.floor(toolSpan.start_time / 1000)
  const spanEndSec = toolSpan.end_time ? Math.ceil(toolSpan.end_time / 1000) + 1 : spanStartSec + 60

  return (
    externalApiCalls.find(
      (call) =>
        call.created_at >= spanStartSec &&
        call.created_at <= spanEndSec &&
        (allowedOperations.length === 0 || allowedOperations.includes(call.operation))
    ) ?? null
  )
}

function findExternalCallForToolResultMessage(params: {
  message: Message
  toolName?: string
  externalApiCalls: ExternalApiCallInfo[]
}): ExternalApiCallInfo | null {
  const { message, toolName, externalApiCalls } = params
  if (externalApiCalls.length === 0) return null

  const toolCallId = getToolResultCallId(message)
  if (toolCallId) {
    const exact = externalApiCalls.find((call) => call.tool_call_id === toolCallId)
    if (exact) return exact
  }

  const operation = toolName ? MEDIA_TOOL_OPERATION_BY_TOOL_NAME[toolName] : null
  if (!operation) return null

  const around = externalApiCalls
    .filter((call) => call.operation === operation)
    .sort(
      (a, b) =>
        Math.abs(a.created_at - message.created_at) - Math.abs(b.created_at - message.created_at)
    )
  return around[0] ?? null
}

function resolveMediaArtifactForToolResultMessage(params: {
  message: Message
  toolName?: string
  externalApiCall: ExternalApiCallInfo | null
  mediaArtifacts: TraceMediaArtifactInfo[]
  mediaArtifactsById: Map<string, TraceMediaArtifactInfo>
}): TraceMediaArtifactInfo | null {
  const { message, toolName, externalApiCall, mediaArtifacts, mediaArtifactsById } = params

  if (externalApiCall?.media_artifact_id) {
    const linked = mediaArtifactsById.get(externalApiCall.media_artifact_id)
    if (linked) return linked
  }

  const outputPath = extractMediaPathFromToolResult(message)
  if (outputPath) {
    const byPath = mediaArtifacts.find((artifact) => artifact.file_path === outputPath)
    if (byPath) return byPath
  }

  const operation = toolName ? MEDIA_TOOL_OPERATION_BY_TOOL_NAME[toolName] : null
  if (!operation) return null
  const byOperation = mediaArtifacts
    .filter((artifact) => artifact.operation === operation)
    .sort(
      (a, b) =>
        Math.abs(a.created_at - message.created_at) - Math.abs(b.created_at - message.created_at)
    )
  return byOperation[0] ?? null
}

/** tool_batch: show all child tool_exec calls with their I/O */
function ToolBatchDetail({
  span,
  messages,
  allSpans,
  runActive,
  externalApiCalls = [],
  mediaArtifacts = [],
  mediaArtifactsById = new Map<string, TraceMediaArtifactInfo>(),
  backgroundTaskMap,
}: {
  span: Span
  messages: Message[]
  allSpans: Span[]
  runActive: boolean
  externalApiCalls?: ExternalApiCallInfo[]
  mediaArtifacts?: TraceMediaArtifactInfo[]
  mediaArtifactsById?: Map<string, TraceMediaArtifactInfo>
  backgroundTaskMap?: Map<string, BackgroundTaskInfo>
}) {
  const toolExecSpans = allSpans
    .filter((s) => s.parent_span_id === span.id && s.name === 'tool_exec')
    .sort((a, b) => a.start_time - b.start_time)

  if (toolExecSpans.length === 0) return null

  return (
    <div className="px-4 py-3">
      <h5 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Tool Calls ({toolExecSpans.length})
      </h5>
      <div className="space-y-3">
        {toolExecSpans.map((toolSpan) => {
          const toolAttrs = parseAttributes(toolSpan.attributes)
          const { callMsg, resultMsg } = getToolExecMessages(toolSpan, messages)
          const isErr = toolSpan.status === 'error'
          const extCost = findExternalCostForSpan(toolSpan, externalApiCalls)
          const tcId = toolAttrs.tool_call_id as string | undefined
          const bgTask = tcId && backgroundTaskMap ? backgroundTaskMap.get(tcId) : null

          return (
            <div
              key={toolSpan.id}
              className={cn(
                'rounded-md border',
                isErr ? 'border-red-500/20 bg-red-500/[0.02]' : 'border-white/10 bg-white/[0.02]'
              )}
            >
              <div
                className={cn(
                  'flex items-center justify-between border-b px-3 py-1.5 text-[10px] font-medium',
                  isErr ? 'border-red-500/10 text-red-400' : 'border-white/5 text-muted-foreground'
                )}
              >
                <div className="flex items-center gap-2">
                  <IconTool className="h-3 w-3" />
                  <span className="font-mono">{(toolAttrs.tool_name as string) ?? 'unknown'}</span>
                  {isErr && (
                    <span className="rounded bg-red-500/20 px-1 py-0.5 text-[9px]">failed</span>
                  )}
                  {extCost && <ExternalCallCostBadge call={extCost} />}
                </div>
                <span className="tabular-nums">
                  {formatDuration(toolSpan.duration_ms, runActive)}
                </span>
              </div>
              <div className="space-y-2 p-2">
                {callMsg && (
                  <ToolCallCard message={callMsg} toolCallId={toolAttrs.tool_call_id as string} />
                )}
                {resultMsg && (
                  <ToolResultCard
                    message={resultMsg}
                    toolName={toolAttrs.tool_name as string}
                    externalApiCalls={externalApiCalls}
                    mediaArtifacts={mediaArtifacts}
                    mediaArtifactsById={mediaArtifactsById}
                  />
                )}
                {isErr && typeof toolAttrs.error === 'string' && !resultMsg && (
                  <div className="rounded border border-red-500/20 bg-red-500/[0.05] px-3 py-2 text-[10px] text-red-400">
                    {toolAttrs.error}
                  </div>
                )}
                {bgTask && <BackgroundTaskInline task={bgTask} />}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** model_call: show the assistant's response (text + tool calls) for THIS model call only */
function ModelCallDetail({
  span,
  messages,
  allSpans,
  inferenceCalls = [],
}: {
  span: Span
  messages: Message[]
  allSpans: Span[]
  inferenceCalls?: InferenceCallReceipt[]
}) {
  // Find the parent turn, then get tool_call_ids from sibling tool_batch
  const parentTurn = span.parent_span_id ? allSpans.find((s) => s.id === span.parent_span_id) : null
  const toolCallIds = parentTurn ? getDescendantToolCallIds(parentTurn.id, allSpans) : []
  const parentTurnAttrs = parentTurn ? parseAttributes(parentTurn.attributes) : {}
  const turnNumber =
    typeof parentTurnAttrs.turn_number === 'number' ? parentTurnAttrs.turn_number : null

  // Find the exact assistant message for this turn
  let assistantMsg: Message | null = null
  if (toolCallIds.length > 0) {
    assistantMsg = findAssistantMessageByToolCallIds(toolCallIds, messages)
  }

  // Fallback for text-only model calls (no tool calls)
  if (!assistantMsg && parentTurn) {
    assistantMsg = getTurnAssistantMessage(parentTurn, allSpans, messages)
  }

  const receipts = inferenceCalls
    .filter((call) => {
      if (call.model_span_id === span.id) return true
      if (call.model_span_id !== null) return false
      if (turnNumber == null || call.turn !== turnNumber) return false
      return call.attempt_kind == null || MODEL_SPAN_ATTEMPT_KINDS.has(call.attempt_kind)
    })
    .sort((a, b) => {
      const aIndex = a.attempt_index ?? 0
      const bIndex = b.attempt_index ?? 0
      if (aIndex !== bIndex) return aIndex - bIndex
      return a.created_at - b.created_at
    })

  if (!assistantMsg && receipts.length === 0) return null

  return (
    <div>
      {assistantMsg && (
        <div className="border-b border-white/5 px-4 py-3">
          <h5 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Model Response
          </h5>
          <AssistantMessageContent message={assistantMsg} />
        </div>
      )}

      {receipts.length > 0 && (
        <div className="border-b border-white/5 px-4 py-3">
          <h5 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Exact Model Payload
          </h5>
          <div className="space-y-2">
            {receipts.map((receipt) => {
              const requestPayload = formatPayloadJson(receipt.request_payload_json)
              const responsePayload = formatPayloadJson(receipt.response_payload_json)
              const hasPayloadHashes =
                receipt.request_payload_hash != null || receipt.response_payload_hash != null

              return (
                <details
                  key={receipt.id}
                  className="rounded border border-white/10 bg-white/[0.02] px-3 py-2"
                >
                  <summary className="cursor-pointer text-[10px] text-foreground/80">
                    {formatAttemptKindLabel(receipt.attempt_kind)}
                    {receipt.attempt_index != null ? ` #${receipt.attempt_index}` : ''}
                    {receipt.finish_reason ? ` · ${receipt.finish_reason}` : ''}
                  </summary>
                  <div className="mt-2 space-y-2 text-[10px]">
                    {receipt.payload_state === 'legacy_unavailable' && (
                      <div className="rounded border border-amber-500/20 bg-amber-500/[0.04] px-2 py-1 text-amber-300/85">
                        Exact payload unavailable (captured before receipts upgrade).
                      </div>
                    )}
                    {receipt.payload_state === 'reconstructed' && (
                      <div className="rounded border border-amber-500/20 bg-amber-500/[0.04] px-2 py-1 text-amber-300/85">
                        Reconstructed payload from logs (non-authoritative).
                      </div>
                    )}
                    {!hasPayloadHashes &&
                      receipt.payload_state !== 'legacy_unavailable' &&
                      receipt.payload_state !== 'reconstructed' && (
                        <div className="rounded border border-white/10 bg-white/[0.02] px-2 py-1 text-white/60">
                          Exact payload unavailable.
                        </div>
                      )}
                    {hasPayloadHashes && (
                      <>
                        <div>
                          <div className="mb-1 text-[10px] uppercase tracking-wider text-white/45">
                            Request
                          </div>
                          {requestPayload ? (
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-white/10 bg-[#09090b] p-2 font-mono text-[10px] text-foreground/80">
                              {requestPayload}
                            </pre>
                          ) : (
                            <div className="text-white/50">Request payload blob unavailable.</div>
                          )}
                        </div>
                        <div>
                          <div className="mb-1 text-[10px] uppercase tracking-wider text-white/45">
                            Response
                          </div>
                          {responsePayload ? (
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-white/10 bg-[#09090b] p-2 font-mono text-[10px] text-foreground/80">
                              {responsePayload}
                            </pre>
                          ) : (
                            <div className="text-white/50">Response payload blob unavailable.</div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </details>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function passiveMemoryStageLabel(call: InferenceCallReceipt): string {
  if (call.attempt_kind === 'passive_memory_refine' || call.turn >= PASSIVE_MEMORY_REFINE_TURN_BASE) {
    return 'refine'
  }
  return 'extract'
}

function PassiveMemoryDetail({
  span,
  inferenceCalls = [],
}: {
  span: Span
  inferenceCalls?: InferenceCallReceipt[]
}) {
  const receipts = inferenceCalls
    .filter((call) => {
      if (call.model_span_id === span.id) return true
      if (call.model_span_id !== null) return false
      return call.turn >= PASSIVE_MEMORY_EXTRACT_TURN_BASE
    })
    .sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at - b.created_at
      const aIndex = a.attempt_index ?? 0
      const bIndex = b.attempt_index ?? 0
      return aIndex - bIndex
    })

  if (receipts.length === 0) return null

  return (
    <div className="border-b border-white/5 px-4 py-3">
      <h5 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Passive Memory Calls
      </h5>
      <div className="space-y-2">
        {receipts.map((call) => (
          <div key={call.id} className="rounded border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-mono text-foreground/90">
                {passiveMemoryStageLabel(call)} · {call.model}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatCost(call.cost_usd ?? 0)}
              </span>
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {call.prompt_tokens.toLocaleString()} in / {call.completion_tokens.toLocaleString()} out
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** post_process: show the final processed response */
function PostProcessDetail({ span, messages }: { span: Span; messages: Message[] }) {
  // Find the assistant message with is_final_response flag within this span's time window
  const startSec = Math.floor(span.start_time / 1000)
  const endSec = span.end_time ? Math.ceil(span.end_time / 1000) + 1 : Infinity

  const finalMsg = messages.find((m) => {
    if (m.role !== 'assistant' || !m.content) return false
    if (m.created_at < startSec || m.created_at > endSec) return false
    try {
      const parsed = JSON.parse(m.content) as { is_final_response?: boolean }
      return parsed.is_final_response === true
    } catch {
      return false
    }
  })

  if (!finalMsg) return null

  return (
    <div className="border-b border-white/5 px-4 py-3">
      <h5 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Final Response
      </h5>
      <AssistantMessageContent message={finalMsg} />
    </div>
  )
}

/** turn: show the full conversation flow for this specific turn */
function TurnDetail({
  span,
  messages,
  allSpans,
  externalApiCalls = [],
  mediaArtifacts = [],
  mediaArtifactsById = new Map<string, TraceMediaArtifactInfo>(),
}: {
  span: Span
  messages: Message[]
  allSpans: Span[]
  externalApiCalls?: ExternalApiCallInfo[]
  mediaArtifacts?: TraceMediaArtifactInfo[]
  mediaArtifactsById?: Map<string, TraceMediaArtifactInfo>
}) {
  const toolCallIds = getDescendantToolCallIds(span.id, allSpans)
  const toolCallNameMap = useMemo(() => buildToolCallNameMap(allSpans), [allSpans])
  const assistantMsg =
    toolCallIds.length > 0
      ? findAssistantMessageByToolCallIds(toolCallIds, messages)
      : getTurnAssistantMessage(span, allSpans, messages)
  const toolResults = findToolResultsByIds(toolCallIds, messages)
  const toolResultsWithNames = toolResults.map((msg) => {
    const tcId = getToolResultCallId(msg)
    return {
      message: msg,
      toolName: tcId ? (toolCallNameMap.get(tcId) ?? undefined) : undefined,
    }
  })

  // Find external costs for tool_exec spans in this turn
  const turnToolCallIds = new Set(getDescendantToolCallIds(span.id, allSpans))
  const turnToolSpans = allSpans.filter((s) => {
    if (s.name !== 'tool_exec') return false
    const attrs = parseAttributes(s.attributes)
    const toolCallId = typeof attrs.tool_call_id === 'string' ? attrs.tool_call_id : null
    return toolCallId ? turnToolCallIds.has(toolCallId) : false
  })
  const turnExtCosts = turnToolSpans
    .map((s) => findExternalCostForSpan(s, externalApiCalls))
    .filter((c): c is ExternalApiCallInfo => c !== null)
  const seenExternalCallIds = new Set<string>()
  const turnExtTotal = turnExtCosts.reduce((sum, call) => {
    if (seenExternalCallIds.has(call.id)) return sum
    seenExternalCallIds.add(call.id)
    return sum + (call.cost_usd ?? 0)
  }, 0)
  const turnExtUniqueCalls = Array.from(
    new Map(turnExtCosts.map((call) => [call.id, call])).values()
  )
  const turnExtUnknownCount = turnExtUniqueCalls.filter((call) => call.cost_usd == null).length

  const hasContent = assistantMsg || toolResults.length > 0
  if (!hasContent) return null

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <h5 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Conversation
        </h5>
        {turnExtUniqueCalls.length > 0 && (
          <ExternalCostBadge cost={turnExtTotal} unknownCount={turnExtUnknownCount} />
        )}
      </div>
      <div className="space-y-2">
        {assistantMsg && <AssistantMessageContent message={assistantMsg} />}
        {toolResultsWithNames.map(({ message, toolName }) => (
          <ToolResultCard
            key={message.id}
            message={message}
            toolName={toolName}
            externalApiCalls={externalApiCalls}
            mediaArtifacts={mediaArtifacts}
            mediaArtifactsById={mediaArtifactsById}
          />
        ))}
      </div>
    </div>
  )
}

/** job: show all messages */
function JobDetail({
  messages,
  allSpans = [],
  sessionHistory = EMPTY_PROMPT_SESSION_HISTORY,
  siblingMessages = [],
  agentByHandle = {},
  assistantLabel,
  defaultUserLabel,
  applyDefaultUserLabelToHistory = false,
  externalApiCalls = [],
  mediaArtifacts = [],
  mediaArtifactsById = new Map<string, TraceMediaArtifactInfo>(),
  scrollContainerRef,
  backgroundTaskMap,
}: {
  messages: Message[]
  allSpans?: Span[]
  sessionHistory?: PromptSessionHistory
  siblingMessages?: SiblingMessage[]
  agentByHandle?: AgentIdentityByHandle
  assistantLabel?: string
  defaultUserLabel?: string
  applyDefaultUserLabelToHistory?: boolean
  externalApiCalls?: ExternalApiCallInfo[]
  mediaArtifacts?: TraceMediaArtifactInfo[]
  mediaArtifactsById?: Map<string, TraceMediaArtifactInfo>
  scrollContainerRef?: ScrollContainerRef
  backgroundTaskMap?: Map<string, BackgroundTaskInfo>
}) {
  const totalExtCost = externalApiCalls.reduce((sum, c) => sum + (c.cost_usd ?? 0), 0)
  const unknownExternalCount = externalApiCalls.filter((call) => call.cost_usd == null).length
  const bgMap = backgroundTaskMap ?? new Map<string, BackgroundTaskInfo>()

  // Build tool call status map from tool_exec spans
  const toolCallStatusMap = useMemo(() => {
    const map = new Map<string, 'pending' | 'ok' | 'error'>()
    for (const span of allSpans) {
      if (span.name !== 'tool_exec') continue
      const attrs = parseAttributes(span.attributes)
      const tcId = attrs.tool_call_id as string | undefined
      if (!tcId) continue
      if (span.status === 'error') {
        map.set(tcId, 'error')
      } else if (span.end_time == null) {
        map.set(tcId, 'pending')
      } else {
        map.set(tcId, 'ok')
      }
    }
    return map
  }, [allSpans])
  const toolCallNameMap = useMemo(() => buildToolCallNameMap(allSpans), [allSpans])

  // Split: system | session history | user prompt | sibling replies | agent responses
  const systemMessages = messages.filter((m) => m.role === 'system')
  const restMessages = messages.filter((m) => m.role !== 'system')
  // Leading user messages (the prompt context), then everything after
  const firstNonUserIdx = restMessages.findIndex((m) => m.role !== 'user')
  const userPromptMessages =
    firstNonUserIdx === -1 ? restMessages : restMessages.slice(0, firstNonUserIdx)
  const agentResponses = useMemo(
    () => (firstNonUserIdx === -1 ? [] : restMessages.slice(firstNonUserIdx)),
    [firstNonUserIdx, restMessages]
  )
  const agentResponseBlocks = useMemo(
    () => buildAgentResponseBlocks(agentResponses),
    [agentResponses]
  )

  if (
    messages.length === 0 &&
    externalApiCalls.length === 0 &&
    sessionHistory.messages.length === 0
  )
    return null

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <h5 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Messages ({messages.length})
        </h5>
        {externalApiCalls.length > 0 && (
          <ExternalCostBadge cost={totalExtCost} unknownCount={unknownExternalCount} />
        )}
      </div>
      <div className="space-y-2">
        {systemMessages.map((msg) => (
          <CompactMessage key={msg.id} message={msg} />
        ))}
        {sessionHistory.messages.length > 0 && (
          <SessionHistorySection
            history={sessionHistory}
            scrollContainerRef={scrollContainerRef}
            agentByHandle={agentByHandle}
            defaultUserLabel={defaultUserLabel}
            applyDefaultUserLabel={applyDefaultUserLabelToHistory}
          />
        )}
        {userPromptMessages.map((msg) => (
          <MessageOrBackgroundTask
            key={msg.id}
            message={msg}
            backgroundTaskMap={bgMap}
            toolCallNameMap={toolCallNameMap}
            externalApiCalls={externalApiCalls}
            mediaArtifacts={mediaArtifacts}
            mediaArtifactsById={mediaArtifactsById}
            defaultUserLabel={defaultUserLabel}
          />
        ))}
        {siblingMessages.map((msg) => (
          <CompactMessage
            key={msg.id}
            message={msg}
            roleLabel={`${msg.agentEmoji ?? ''} ${msg.agentName}`.trim()}
            styleOverride="text-indigo-400 border-indigo-400/20 bg-indigo-400/[0.04]"
          />
        ))}
        {agentResponseBlocks.map((block) =>
          block.kind === 'assistant-tool-exchange' ? (
            <AssistantToolExchange
              key={`exchange-${block.assistant.id}`}
              assistantMessage={block.assistant}
              toolResultMessages={block.toolResults}
              toolCallNameMap={toolCallNameMap}
              backgroundTaskMap={bgMap}
              externalApiCalls={externalApiCalls}
              mediaArtifacts={mediaArtifacts}
              mediaArtifactsById={mediaArtifactsById}
              defaultUserLabel={defaultUserLabel}
              assistantLabel={assistantLabel}
              toolCallStatusMap={toolCallStatusMap}
            />
          ) : (
            <MessageOrBackgroundTask
              key={block.message.id}
              message={block.message}
              backgroundTaskMap={bgMap}
              toolCallNameMap={toolCallNameMap}
              externalApiCalls={externalApiCalls}
              mediaArtifacts={mediaArtifacts}
              mediaArtifactsById={mediaArtifactsById}
              defaultUserLabel={defaultUserLabel}
              assistantLabel={assistantLabel}
              toolCallStatusMap={toolCallStatusMap}
            />
          )
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared display components
// ---------------------------------------------------------------------------

/** Compact badge showing external API cost */
function ExternalCostBadge({ cost, unknownCount = 0 }: { cost: number; unknownCount?: number }) {
  const hasUnknown = unknownCount > 0
  return (
    <span
      className={cn(
        'rounded border px-1.5 py-0.5 text-[9px] font-medium',
        hasUnknown
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
      )}
    >
      {formatCost(cost)} external
      {hasUnknown ? ` + ${unknownCount} unpriced` : ''}
    </span>
  )
}

function ExternalCallCostBadge({ call }: { call: ExternalApiCallInfo }) {
  const isUnpriced = call.cost_usd == null
  const isEstimated = call.pricing_status === 'estimated'
  const className = isUnpriced
    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    : isEstimated
      ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
  const label = isUnpriced
    ? 'unpriced external'
    : `${formatCost(call.cost_usd ?? 0)} external${isEstimated ? ' (est.)' : ''}`

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        className={cn('rounded border px-1.5 py-0.5 text-[9px] font-medium', className)}
      >
        {label}
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[10px]">
        <div className="space-y-0.5">
          <div>
            {call.provider} / {call.operation}
          </div>
          <div className="text-white/70">
            pricing: {call.pricing_status}
            {call.pricing_source ? ` (${call.pricing_source})` : ''}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function defaultArtifactMimeType(artifactType: string): string {
  if (artifactType === 'image') return 'image/png'
  if (artifactType === 'audio') return 'audio/mpeg'
  return 'application/octet-stream'
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType })
}

function ToolMediaArtifactPreview({
  mediaArtifactId,
  artifact,
}: {
  mediaArtifactId: string
  artifact: TraceMediaArtifactInfo | null
}) {
  const supportsPreview =
    artifact?.artifact_type === 'image' || artifact?.artifact_type === 'audio' || false
  const [loadRequested, setLoadRequested] = useState(false)
  const contentQuery = trpc.mediaArtifacts.getContent.useQuery(
    { artifactId: mediaArtifactId },
    {
      enabled: supportsPreview && loadRequested,
      retry: false,
      staleTime: Infinity,
      gcTime: Infinity,
      trpc: { context: { skipBatch: true } },
    }
  )
  const mimeType = artifact?.mime_type ?? defaultArtifactMimeType(artifact?.artifact_type ?? '')
  const dataUrl = useMemo(() => {
    if (!contentQuery.data) return null
    return `data:${mimeType};base64,${contentQuery.data.dataBase64}`
  }, [contentQuery.data, mimeType])
  const blobUrl = useMemo(() => {
    if (!contentQuery.data) return null
    try {
      const blob = base64ToBlob(contentQuery.data.dataBase64, mimeType)
      return URL.createObjectURL(blob)
    } catch {
      return null
    }
  }, [contentQuery.data, mimeType])

  useEffect(() => {
    if (!blobUrl) return
    return () => URL.revokeObjectURL(blobUrl)
  }, [blobUrl])

  return (
    <div className="space-y-2 text-[10px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-white/70">Media</span>
        {artifact?.artifact_type && (
          <span className="rounded bg-white/10 px-1 py-0.5 uppercase text-[9px]">
            {artifact.artifact_type}
          </span>
        )}
        {artifact?.file_name && (
          <span className="font-mono text-white/55">{artifact.file_name}</span>
        )}
      </div>

      {supportsPreview && (
        <div className="space-y-2">
          {!loadRequested && (
            <button
              onClick={() => setLoadRequested(true)}
              className="rounded border border-white/20 px-2 py-1 text-[10px] text-white/80 hover:bg-white/5"
            >
              Load media preview
            </button>
          )}
          {contentQuery.isLoading && <div className="text-white/55">Loading media...</div>}
          {contentQuery.error && (
            <div className="text-amber-300">
              {contentQuery.error.message || 'Media blob unavailable for preview.'}
            </div>
          )}
          {artifact?.artifact_type === 'image' && dataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={dataUrl}
              alt={artifact.file_name ?? mediaArtifactId}
              className="max-h-56 rounded border border-white/10"
            />
          )}
          {artifact?.artifact_type === 'audio' && dataUrl && (
            <audio controls preload="none" src={dataUrl} className="w-full" />
          )}
          {(blobUrl || dataUrl) && (
            <div className="flex items-center gap-3">
              <a
                href={blobUrl ?? dataUrl!}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                Open
              </a>
              <a
                href={blobUrl ?? dataUrl!}
                download={artifact?.file_name ?? `${mediaArtifactId}.bin`}
                className="text-primary hover:underline"
              >
                Download
              </a>
            </div>
          )}
        </div>
      )}
      {artifact?.file_path && (
        <details className="text-[10px]">
          <summary className="cursor-pointer text-white/45">Metadata</summary>
          <div className="mt-1 font-mono text-white/45">sandbox path: {artifact.file_path}</div>
        </details>
      )}
    </div>
  )
}

/** Render an assistant message: text content + tool calls list */
function AssistantMessageContent({ message }: { message: Message }) {
  const [expanded, setExpanded] = useState(false)
  const [expandedReasoningByIndex, setExpandedReasoningByIndex] = useState<Record<number, boolean>>(
    {}
  )

  if (!message.content) return null

  const { text, toolCalls, reasoningSegments } = parseStoredMessagePayload(message.content)

  const isLong = text.length > 400
  const preview = isLong && !expanded ? `${text.slice(0, 400)}...` : text

  return (
    <div className="space-y-2">
      {reasoningSegments.map((reasoning, index) => {
        const reasoningIsLong = reasoning.length > 400
        const isExpanded = expandedReasoningByIndex[index] === true
        const reasoningPreview =
          reasoningIsLong && !isExpanded ? `${reasoning.slice(0, 400)}...` : reasoning

        return (
          <div
            key={`${message.id}-reasoning-${index}`}
            className="mb-3 rounded-md border border-blue-400/20 bg-blue-400/[0.04] p-2"
          >
            <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-blue-300">
              <IconBrain className="h-3 w-3" />
              {reasoningSegments.length > 1 ? `reasoning ${index + 1}` : 'reasoning'}
            </div>
            <pre className="whitespace-pre-wrap text-[10px] text-foreground/70">
              {reasoningPreview}
            </pre>
            {reasoningIsLong && (
              <button
                onClick={() =>
                  setExpandedReasoningByIndex((prev) => ({
                    ...prev,
                    [index]: !isExpanded,
                  }))
                }
                className="mt-1 text-[10px] text-white/30 hover:text-white/60"
              >
                {isExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )
      })}
      {text && (
        <div className="rounded-md border border-emerald-400/20 bg-emerald-400/[0.04] p-2">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-emerald-400">
            assistant
          </div>
          <pre className="whitespace-pre-wrap text-[10px] text-foreground/70">{preview}</pre>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1 text-[10px] text-white/30 hover:text-white/60"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}
      {toolCalls.length > 0 && (
        <div className="space-y-1">
          {toolCalls.map((tc) => {
            let args: unknown
            try {
              args = JSON.parse(tc.function?.arguments ?? '{}')
            } catch {
              args = tc.function?.arguments
            }
            return (
              <div
                key={tc.id}
                className="rounded-md border border-amber-500/20 bg-amber-500/[0.03]"
              >
                <div className="flex items-center gap-2 border-b border-amber-500/10 px-3 py-1.5 text-[10px] font-medium text-amber-400">
                  <IconTool className="h-3 w-3" />
                  {tc.function?.name ?? 'unknown'}
                  <span className="text-amber-400/40">call</span>
                </div>
                <pre className="max-h-48 overflow-auto px-3 py-2 text-[10px] text-foreground/80">
                  {typeof args === 'string' ? args : JSON.stringify(args, null, 2)}
                </pre>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface ToolArgHighlight {
  label: string
  value: string
}

function countUtf8Bytes(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length
  }
  return text.length
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringifyArgValue(value: unknown, max = 80): string {
  if (typeof value === 'string') {
    return value.length > max ? `${value.slice(0, max)}...` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'bigint') return `${value}n`
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `${value.length} item(s)`
  if (value && typeof value === 'object') return '{...}'
  if (typeof value === 'symbol') {
    return value.description ? `Symbol(${value.description})` : 'Symbol'
  }
  return ''
}

function buildToolArgHighlights(toolName: string, args: unknown): ToolArgHighlight[] {
  const obj = asRecord(args)
  if (!obj) return []

  const getString = (key: string) => {
    const value = obj[key]
    return typeof value === 'string' && value.trim().length > 0 ? value : null
  }
  const getNumber = (key: string) => {
    const value = obj[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  const getBoolean = (key: string) => {
    const value = obj[key]
    return typeof value === 'boolean' ? value : null
  }
  const getArrayCount = (key: string) => {
    const value = obj[key]
    return Array.isArray(value) ? value.length : null
  }

  const highlights: ToolArgHighlight[] = []
  switch (toolName) {
    case 'web_search':
      if (getString('query'))
        highlights.push({ label: 'query', value: stringifyArgValue(getString('query')) })
      if (getNumber('max_results') != null)
        highlights.push({ label: 'max', value: `${getNumber('max_results')}` })
      if (getString('topic')) highlights.push({ label: 'topic', value: getString('topic')! })
      if (getString('time_range'))
        highlights.push({ label: 'window', value: getString('time_range')! })
      if (getArrayCount('include_domains') != null)
        highlights.push({
          label: 'allow',
          value: `${getArrayCount('include_domains')} domain(s)`,
        })
      if (getArrayCount('exclude_domains') != null)
        highlights.push({
          label: 'deny',
          value: `${getArrayCount('exclude_domains')} domain(s)`,
        })
      break
    case 'extract_url':
      if (getArrayCount('urls') != null)
        highlights.push({ label: 'urls', value: `${getArrayCount('urls')} URL(s)` })
      if (getString('query'))
        highlights.push({ label: 'query', value: stringifyArgValue(getString('query')) })
      if (getNumber('chunks_per_source') != null)
        highlights.push({ label: 'chunks', value: `${getNumber('chunks_per_source')}` })
      break
    case 'read_file':
      if (getString('path'))
        highlights.push({ label: 'path', value: stringifyArgValue(getString('path')) })
      if (getNumber('start_line') != null)
        highlights.push({ label: 'start', value: `${getNumber('start_line')}` })
      if (getNumber('max_lines') != null)
        highlights.push({ label: 'max', value: `${getNumber('max_lines')}` })
      break
    case 'write_file':
      if (getString('path'))
        highlights.push({ label: 'path', value: stringifyArgValue(getString('path')) })
      if (getString('content')) {
        highlights.push({ label: 'bytes', value: `${countUtf8Bytes(getString('content')!)}` })
      }
      break
    case 'edit_file':
      if (getString('path'))
        highlights.push({ label: 'path', value: stringifyArgValue(getString('path')) })
      if (getArrayCount('edits') != null)
        highlights.push({ label: 'edits', value: `${getArrayCount('edits')}` })
      else if (getString('old_string') != null && getString('new_string') != null)
        highlights.push({ label: 'mode', value: 'replace' })
      if (getBoolean('replace_all') === true) highlights.push({ label: 'all', value: 'true' })
      break
    case 'use_skill':
      if (getString('skill_name'))
        highlights.push({ label: 'skill', value: stringifyArgValue(getString('skill_name')) })
      break
    case 'list_directory':
    case 'create_directory':
      if (getString('path'))
        highlights.push({ label: 'path', value: stringifyArgValue(getString('path')) })
      break
    case 'bash':
      if (getString('command'))
        highlights.push({ label: 'command', value: stringifyArgValue(getString('command')!, 120) })
      if (getString('cwd'))
        highlights.push({ label: 'cwd', value: stringifyArgValue(getString('cwd')) })
      if (getNumber('timeout') != null)
        highlights.push({ label: 'timeout', value: `${getNumber('timeout')}s` })
      break
    case 'refresh_network_policy':
      if (getString('preset'))
        highlights.push({ label: 'preset', value: stringifyArgValue(getString('preset')) })
      break
    case 'add_memory':
      if (getString('content'))
        highlights.push({
          label: 'memory',
          value: stringifyArgValue(getString('content')!, 110),
        })
      if (getBoolean('permanent') != null)
        highlights.push({ label: 'pinned', value: `${getBoolean('permanent')}` })
      break
    case 'remove_memory':
      if (getString('memory_id'))
        highlights.push({ label: 'id', value: stringifyArgValue(getString('memory_id')) })
      if (getString('content'))
        highlights.push({
          label: 'match',
          value: stringifyArgValue(getString('content')!, 100),
        })
      if (getString('match_mode'))
        highlights.push({ label: 'mode', value: stringifyArgValue(getString('match_mode')) })
      break
    case 'update_memory':
      if (getString('memory_id'))
        highlights.push({ label: 'id', value: stringifyArgValue(getString('memory_id')) })
      if (getString('content'))
        highlights.push({
          label: 'from',
          value: stringifyArgValue(getString('content')!, 90),
        })
      if (getString('new_content'))
        highlights.push({
          label: 'to',
          value: stringifyArgValue(getString('new_content')!, 90),
        })
      if (getBoolean('permanent') != null)
        highlights.push({ label: 'pinned', value: `${getBoolean('permanent')}` })
      if (getBoolean('delete') === true) highlights.push({ label: 'delete', value: 'true' })
      if (getNumber('version') != null)
        highlights.push({ label: 'version', value: `${getNumber('version')}` })
      break
    case 'start_background_task':
      if (getString('command'))
        highlights.push({
          label: 'command',
          value: stringifyArgValue(getString('command')!, 100),
        })
      if (getString('label'))
        highlights.push({ label: 'label', value: stringifyArgValue(getString('label')) })
      if (getString('cwd'))
        highlights.push({ label: 'cwd', value: stringifyArgValue(getString('cwd')) })
      if (getBoolean('cleanup_on_run_end') != null)
        highlights.push({
          label: 'cleanup',
          value: `${getBoolean('cleanup_on_run_end')}`,
        })
      break
    case 'check_background_task':
      if (getString('task_id'))
        highlights.push({ label: 'task', value: stringifyArgValue(getString('task_id')) })
      if (getBoolean('block') != null)
        highlights.push({ label: 'block', value: `${getBoolean('block')}` })
      if (getNumber('timeout_seconds') != null)
        highlights.push({ label: 'wait', value: `${getNumber('timeout_seconds')}s` })
      if (getNumber('output_chars') != null)
        highlights.push({ label: 'tail', value: `${getNumber('output_chars')}` })
      break
    case 'list_background_tasks':
      if (getString('status'))
        highlights.push({ label: 'status', value: stringifyArgValue(getString('status')) })
      if (getBoolean('include_output') != null)
        highlights.push({ label: 'output', value: `${getBoolean('include_output')}` })
      if (getNumber('output_chars') != null)
        highlights.push({ label: 'tail', value: `${getNumber('output_chars')}` })
      break
    case 'stop_background_task':
      if (getString('task_id'))
        highlights.push({ label: 'task', value: stringifyArgValue(getString('task_id')) })
      if (getBoolean('force') != null)
        highlights.push({ label: 'force', value: `${getBoolean('force')}` })
      if (getNumber('grace_seconds') != null)
        highlights.push({ label: 'grace', value: `${getNumber('grace_seconds')}s` })
      break
    case 'schedule_check':
      if (getNumber('delay_minutes') != null)
        highlights.push({ label: 'delay', value: `${getNumber('delay_minutes')}m` })
      if (getString('reference'))
        highlights.push({ label: 'ref', value: stringifyArgValue(getString('reference')) })
      if (getString('instructions'))
        highlights.push({ label: 'chars', value: `${getString('instructions')!.length}` })
      break
    case 'list_schedule':
      if (getBoolean('session_only') != null)
        highlights.push({ label: 'session', value: `${getBoolean('session_only')}` })
      break
    case 'cancel_scheduled':
      if (getString('scheduled_id'))
        highlights.push({ label: 'id', value: stringifyArgValue(getString('scheduled_id')) })
      break
    case 'create_service':
      if (getString('name'))
        highlights.push({ label: 'service', value: stringifyArgValue(getString('name')) })
      if (getString('cmd'))
        highlights.push({ label: 'cmd', value: stringifyArgValue(getString('cmd')) })
      if (getArrayCount('args') != null)
        highlights.push({ label: 'args', value: `${getArrayCount('args')}` })
      if (getNumber('http_port') != null)
        highlights.push({ label: 'port', value: `${getNumber('http_port')}` })
      if (getBoolean('make_public') != null)
        highlights.push({ label: 'public', value: `${getBoolean('make_public')}` })
      break
    case 'list_services':
      break
    case 'manage_service':
      if (getString('name'))
        highlights.push({ label: 'service', value: stringifyArgValue(getString('name')) })
      if (getString('action'))
        highlights.push({ label: 'action', value: stringifyArgValue(getString('action')) })
      break
    case 'get_sprite_url':
      if (getBoolean('make_public') != null)
        highlights.push({ label: 'public', value: `${getBoolean('make_public')}` })
      break
    case 'list_sandboxes':
      break
    case 'switch_sandbox':
    case 'delete_sandbox':
      if (getString('sandbox_name'))
        highlights.push({
          label: 'sandbox',
          value: stringifyArgValue(getString('sandbox_name')),
        })
      break
    case 'create_ephemeral_sandbox':
      if (getString('name'))
        highlights.push({ label: 'name', value: stringifyArgValue(getString('name')) })
      if (getString('description'))
        highlights.push({
          label: 'desc',
          value: stringifyArgValue(getString('description')),
        })
      if (getBoolean('switch_to') != null)
        highlights.push({ label: 'switch', value: `${getBoolean('switch_to')}` })
      break
    case 'configure_github_credentials':
      if (getString('repo_name'))
        highlights.push({ label: 'repo', value: stringifyArgValue(getString('repo_name')) })
      if (getNumber('duration') != null)
        highlights.push({ label: 'ttl', value: `${getNumber('duration')}s` })
      break
    case 'get_self_config':
      break
    case 'send_agent_message':
      if (getString('to_handle'))
        highlights.push({ label: 'to', value: `@${getString('to_handle')}` })
      if (getString('message'))
        highlights.push({
          label: 'chars',
          value: `${getString('message')!.length}`,
        })
      break
    case 'download_attachment':
      if (getNumber('index') != null)
        highlights.push({ label: 'index', value: `${getNumber('index')}` })
      if (getString('save_path'))
        highlights.push({ label: 'save', value: stringifyArgValue(getString('save_path')) })
      break
    case 'send_telegram_message':
      if (getString('message'))
        highlights.push({ label: 'chars', value: `${getString('message')!.length}` })
      if (getNumber('chat_id') != null)
        highlights.push({ label: 'chat', value: `${getNumber('chat_id')}` })
      if (getNumber('thread_id') != null)
        highlights.push({ label: 'thread', value: `${getNumber('thread_id')}` })
      break
    case 'list_telegram_threads':
      if (getNumber('limit') != null)
        highlights.push({ label: 'limit', value: `${getNumber('limit')}` })
      break
    case 'read_telegram_thread':
      if (getString('session_key'))
        highlights.push({ label: 'session', value: stringifyArgValue(getString('session_key')) })
      if (getNumber('limit') != null)
        highlights.push({ label: 'limit', value: `${getNumber('limit')}` })
      break
    case 'send_file':
      if (getString('file_path'))
        highlights.push({ label: 'path', value: stringifyArgValue(getString('file_path')) })
      if (getString('send_as'))
        highlights.push({ label: 'as', value: stringifyArgValue(getString('send_as')) })
      if (getString('caption'))
        highlights.push({ label: 'caption', value: `${getString('caption')!.length} chars` })
      if (getNumber('chat_id') != null)
        highlights.push({ label: 'chat', value: `${getNumber('chat_id')}` })
      if (getNumber('thread_id') != null)
        highlights.push({ label: 'thread', value: `${getNumber('thread_id')}` })
      break
    case 'query_activity':
      if (getString('query'))
        highlights.push({ label: 'query', value: stringifyArgValue(getString('query')) })
      if (getString('agent_handle'))
        highlights.push({ label: 'agent', value: `@${getString('agent_handle')}` })
      if (getString('status'))
        highlights.push({ label: 'status', value: stringifyArgValue(getString('status')) })
      if (getNumber('max_age_minutes') != null)
        highlights.push({ label: 'age', value: `${getNumber('max_age_minutes')}m` })
      if (getNumber('limit') != null)
        highlights.push({ label: 'limit', value: `${getNumber('limit')}` })
      break
    case 'list_runs':
      if (getString('status')) highlights.push({ label: 'status', value: getString('status')! })
      if (getString('source'))
        highlights.push({ label: 'source', value: stringifyArgValue(getString('source')) })
      if (getNumber('max_age_days') != null)
        highlights.push({ label: 'age', value: `${getNumber('max_age_days')}d` })
      if (getNumber('limit') != null)
        highlights.push({ label: 'limit', value: `${getNumber('limit')}` })
      break
    case 'get_run':
      if (getString('run_id'))
        highlights.push({ label: 'run', value: stringifyArgValue(getString('run_id')) })
      if (getString('section'))
        highlights.push({ label: 'section', value: stringifyArgValue(getString('section')) })
      if (getNumber('offset') != null)
        highlights.push({ label: 'offset', value: `${getNumber('offset')}` })
      if (getNumber('limit') != null)
        highlights.push({ label: 'limit', value: `${getNumber('limit')}` })
      break
    case 'run_todo':
      if (getString('action'))
        highlights.push({ label: 'action', value: stringifyArgValue(getString('action')) })
      if (getString('text'))
        highlights.push({ label: 'chars', value: `${getString('text')!.length}` })
      if (getString('item_id'))
        highlights.push({ label: 'item', value: stringifyArgValue(getString('item_id')) })
      if (getString('run_id'))
        highlights.push({ label: 'run', value: stringifyArgValue(getString('run_id')) })
      if (getBoolean('include_done') != null)
        highlights.push({ label: 'done', value: `${getBoolean('include_done')}` })
      break
    default: {
      for (const [key, value] of Object.entries(obj).slice(0, 4)) {
        highlights.push({ label: key, value: stringifyArgValue(value) })
      }
      break
    }
  }

  return highlights.slice(0, 6)
}

function ToolCallCard({ message, toolCallId }: { message: Message; toolCallId: string }) {
  try {
    const parsed = JSON.parse(message.content!) as { tool_calls?: ParsedToolCall[] }
    const tc = parsed.tool_calls?.find((t) => t.id === toolCallId)
    if (!tc?.function) return null

    let args: unknown
    try {
      args = JSON.parse(tc.function.arguments ?? '{}')
    } catch {
      args = tc.function.arguments
    }

    if (tc.function.name === 'bash') {
      const bashArgs =
        args && typeof args === 'object' && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : null
      const command = typeof bashArgs?.command === 'string' ? bashArgs.command : null
      const cwd = typeof bashArgs?.cwd === 'string' ? bashArgs.cwd : null
      const timeout = typeof bashArgs?.timeout === 'number' ? bashArgs.timeout : null

      return (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.03]">
          <div className="flex items-center gap-2 border-b border-amber-500/10 px-3 py-1.5 text-[10px] font-medium text-amber-400">
            <IconTerminal2 className="h-3 w-3" />
            bash
            <span className="text-amber-400/40">call</span>
            {timeout != null && <span className="text-amber-300/70">{timeout}s timeout</span>}
          </div>
          {command ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[10px] text-foreground/85">
              {command}
            </pre>
          ) : (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[10px] text-foreground/85">
              {typeof args === 'string' ? args : JSON.stringify(args, null, 2)}
            </pre>
          )}
          {cwd && (
            <div className="border-t border-amber-500/10 px-3 py-1.5 text-[10px] text-amber-300/70">
              cwd: <span className="font-mono text-foreground/70">{cwd}</span>
            </div>
          )}
        </div>
      )
    }

    const highlights = buildToolArgHighlights(tc.function.name ?? 'unknown', args)
    const rawArgs = typeof args === 'string' ? args : JSON.stringify(args, null, 2)
    const shouldShowRaw = rawArgs.length > 220 || highlights.length === 0

    return (
      <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.03]">
        <div className="flex items-center gap-2 border-b border-amber-500/10 px-3 py-1.5 text-[10px] font-medium text-amber-400">
          <IconTool className="h-3 w-3" />
          {tc.function.name ?? 'unknown'}
          <span className="text-amber-400/40">call</span>
        </div>
        {highlights.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 py-2 text-[10px]">
            {highlights.map((item) => (
              <span
                key={item.label}
                className="rounded border border-amber-500/15 bg-amber-500/[0.06] px-1.5 py-0.5"
              >
                <span className="text-amber-300/70">{item.label}</span>
                <span className="mx-1 text-amber-400/30">=</span>
                <span className="font-mono text-foreground/80">{item.value}</span>
              </span>
            ))}
          </div>
        )}
        {shouldShowRaw && (
          <details className="border-t border-amber-500/10 px-3 py-1.5">
            <summary className="cursor-pointer text-[10px] text-amber-300/70">Raw input</summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-foreground/80">
              {rawArgs}
            </pre>
          </details>
        )}
      </div>
    )
  } catch {
    return null
  }
}

function parseBashResult(display: string): ParsedBashResult {
  const stdoutMatch = display.match(
    /(?:^|\n)stdout:\n([\s\S]*?)(?=\n\n(?:stderr:\n|exit code:\s|duration:\s)|$)/
  )
  const stderrMatch = display.match(
    /(?:^|\n)stderr:\n([\s\S]*?)(?=\n\n(?:stdout:\n|exit code:\s|duration:\s)|$)/
  )
  const exitMatch = display.match(/(?:^|\n)exit code:\s*(-?\d+)(?:\n|$)/)
  const durationMatch = display.match(/(?:^|\n)duration:\s*(\d+)ms(?:\n|$)/)

  return {
    stdout: stdoutMatch?.[1]?.trim() || null,
    stderr: stderrMatch?.[1]?.trim() || null,
    exitCode: exitMatch ? Number.parseInt(exitMatch[1]!, 10) : null,
    durationMs: durationMatch ? Number.parseInt(durationMatch[1]!, 10) : null,
  }
}

function parseWebSearchResult(display: string): {
  query: string | null
  count: number | null
  duration: string | null
  results: Array<{ title: string; score: string }>
} {
  const header = display.match(/Found\s+(\d+)\s+result(?:s)?\s+for\s+"([^"]+)"/)
  const duration = display.match(/Search completed in\s+([0-9.]+s)/)
  const results = Array.from(
    display.matchAll(/^\[(\d+)\]\s+"(.+?)"\s+\(score:\s+([0-9.]+)\)/gm)
  ).map((match) => ({
    title: match[2] ?? '',
    score: match[3] ?? '',
  }))
  return {
    query: header?.[2] ?? null,
    count: header?.[1] ? Number.parseInt(header[1], 10) : null,
    duration: duration?.[1] ?? null,
    results,
  }
}

function parseExtractResult(display: string): {
  extracted: number | null
  failed: number | null
  duration: string | null
  titles: string[]
} {
  const extracted = display.match(/Extracted content from\s+(\d+)\s+URL/)
  const failed = display.match(/Failed to extract\s+(\d+)\s+URL/)
  const duration = display.match(/Extraction completed in\s+([0-9.]+s)/)
  const titles = Array.from(display.matchAll(/^---\s+(.+?)\s+---$/gm)).map((m) => m[1] ?? '')
  return {
    extracted: extracted?.[1] ? Number.parseInt(extracted[1], 10) : null,
    failed: failed?.[1] ? Number.parseInt(failed[1], 10) : null,
    duration: duration?.[1] ?? null,
    titles,
  }
}

function parseDiffStats(diffText: string): { added: number; removed: number } {
  const lines = diffText.split('\n')
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added++
    else if (line.startsWith('-')) removed++
  }
  return { added, removed }
}

function trimOutputContent(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

function splitDisplayLines(display: string): string[] {
  return display
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function ToolResultCard({
  message,
  toolName,
  externalApiCalls = [],
  mediaArtifacts = [],
  mediaArtifactsById = new Map<string, TraceMediaArtifactInfo>(),
}: {
  message: Message
  toolName?: string
  externalApiCalls?: ExternalApiCallInfo[]
  mediaArtifacts?: TraceMediaArtifactInfo[]
  mediaArtifactsById?: Map<string, TraceMediaArtifactInfo>
}) {
  const display = trimOutputContent(parseToolResultDisplay(message))
  const extCall = findExternalCallForToolResultMessage({
    message,
    toolName,
    externalApiCalls,
  })
  const mediaArtifact = resolveMediaArtifactForToolResultMessage({
    message,
    toolName,
    externalApiCall: extCall,
    mediaArtifacts,
    mediaArtifactsById,
  })
  const mediaArtifactId = extCall?.media_artifact_id ?? mediaArtifact?.id ?? null
  const isMediaToolResult = toolName === 'generate_image' || toolName === 'synthesize_speech'

  if (isMediaToolResult) {
    const firstLine = display.split('\n').find((line) => line.trim().length > 0) ?? '(empty)'
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
          <IconPointFilled className="h-3 w-3" />
          {toolName} result
        </div>
        <div className="space-y-2 px-3 py-2 text-[10px] text-foreground/80">
          <div>{firstLine}</div>
          {mediaArtifactId && (
            <ToolMediaArtifactPreview
              mediaArtifactId={mediaArtifactId}
              artifact={mediaArtifact ?? null}
            />
          )}
        </div>
      </div>
    )
  }

  if (toolName === 'bash') {
    const parsed = parseBashResult(display)
    const hasStructured =
      parsed.stdout !== null ||
      parsed.stderr !== null ||
      parsed.exitCode !== null ||
      parsed.durationMs !== null

    if (hasStructured) {
      const isError = parsed.exitCode != null && parsed.exitCode !== 0
      return (
        <div
          className={cn(
            'rounded-md border',
            isError ? 'border-red-500/20 bg-red-500/[0.02]' : 'border-white/10 bg-white/[0.02]'
          )}
        >
          <div
            className={cn(
              'flex items-center gap-2 border-b px-3 py-1.5 text-[10px] font-medium',
              isError ? 'border-red-500/10 text-red-400' : 'border-white/5 text-muted-foreground'
            )}
          >
            <IconTerminal2 className="h-3 w-3" />
            result
            {parsed.exitCode != null && (
              <span
                className={cn(
                  'rounded px-1 py-0.5',
                  isError ? 'bg-red-500/20' : 'bg-emerald-500/20'
                )}
              >
                exit {parsed.exitCode}
              </span>
            )}
            {parsed.durationMs != null && (
              <span className="rounded bg-white/5 px-1 py-0.5 text-white/70">
                {parsed.durationMs}ms
              </span>
            )}
          </div>
          {parsed.stdout && (
            <div className="border-b border-white/5 px-3 py-2">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-emerald-400/80">
                stdout
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-foreground/80">
                {parsed.stdout}
              </pre>
            </div>
          )}
          {parsed.stderr && (
            <div className="px-3 py-2">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-red-400/80">
                stderr
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-foreground/80">
                {parsed.stderr}
              </pre>
            </div>
          )}
        </div>
      )
    }
  }

  if (toolName === 'web_search') {
    const parsed = parseWebSearchResult(display)
    const summary =
      parsed.query && parsed.count != null
        ? `${parsed.count} result${parsed.count === 1 ? '' : 's'} for "${parsed.query}"`
        : 'Search results'
    return (
      <div className="rounded-md border border-cyan-500/20 bg-cyan-500/[0.03]">
        <div className="flex items-center gap-2 border-b border-cyan-500/10 px-3 py-1.5 text-[10px] font-medium text-cyan-400">
          <IconHistory className="h-3 w-3" />
          {summary}
          {parsed.duration && (
            <span className="rounded bg-cyan-500/15 px-1 py-0.5 text-cyan-300/80">
              {parsed.duration}
            </span>
          )}
        </div>
        {parsed.results.length > 0 && (
          <div className="space-y-1 px-3 py-2">
            {parsed.results.slice(0, 6).map((result, index) => (
              <div key={`${result.title}-${index}`} className="text-[10px] text-foreground/80">
                <span className="mr-1 text-cyan-300/70">[{index + 1}]</span>
                {result.title}
                <span className="ml-2 text-cyan-300/60">score {result.score}</span>
              </div>
            ))}
            {parsed.results.length > 6 && (
              <div className="text-[10px] text-cyan-300/60">
                +{parsed.results.length - 6} more results
              </div>
            )}
          </div>
        )}
        <details className="border-t border-cyan-500/10 px-3 py-1.5">
          <summary className="cursor-pointer text-[10px] text-cyan-300/70">Raw output</summary>
          <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap text-[10px] text-foreground/80">
            {display}
          </pre>
        </details>
      </div>
    )
  }

  if (toolName === 'extract_url') {
    const parsed = parseExtractResult(display)
    return (
      <div className="rounded-md border border-cyan-500/20 bg-cyan-500/[0.03]">
        <div className="flex items-center gap-2 border-b border-cyan-500/10 px-3 py-1.5 text-[10px] font-medium text-cyan-400">
          <IconFile className="h-3 w-3" />
          extraction
          {parsed.extracted != null && (
            <span className="rounded bg-cyan-500/15 px-1 py-0.5 text-cyan-300/80">
              {parsed.extracted} extracted
            </span>
          )}
          {parsed.failed != null && parsed.failed > 0 && (
            <span className="rounded bg-red-500/20 px-1 py-0.5 text-red-300/80">
              {parsed.failed} failed
            </span>
          )}
          {parsed.duration && (
            <span className="rounded bg-cyan-500/15 px-1 py-0.5 text-cyan-300/80">
              {parsed.duration}
            </span>
          )}
        </div>
        {parsed.titles.length > 0 && (
          <div className="space-y-1 px-3 py-2">
            {parsed.titles.slice(0, 6).map((title, index) => (
              <div key={`${title}-${index}`} className="text-[10px] text-foreground/80">
                <span className="mr-1 text-cyan-300/70">[{index + 1}]</span>
                {title}
              </div>
            ))}
            {parsed.titles.length > 6 && (
              <div className="text-[10px] text-cyan-300/60">
                +{parsed.titles.length - 6} more items
              </div>
            )}
          </div>
        )}
        <details className="border-t border-cyan-500/10 px-3 py-1.5">
          <summary className="cursor-pointer text-[10px] text-cyan-300/70">Raw output</summary>
          <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap text-[10px] text-foreground/80">
            {display}
          </pre>
        </details>
      </div>
    )
  }

  if (toolName === 'list_directory') {
    const entries = display
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
          <IconFile className="h-3 w-3" />
          directory entries
          <span className="rounded bg-white/5 px-1 py-0.5 text-white/70">{entries.length}</span>
        </div>
        <pre className="max-h-52 overflow-auto whitespace-pre-wrap px-3 py-2 text-[10px] text-foreground/80">
          {entries.slice(0, 120).join('\n')}
          {entries.length > 120 ? `\n\n... ${entries.length - 120} more` : ''}
        </pre>
      </div>
    )
  }

  if (toolName === 'read_file') {
    const lines = display.split('\n')
    const lineCount = lines.filter((line) => line.trim().length > 0).length
    const preview = lines.slice(0, 120).join('\n')
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
          <IconFile className="h-3 w-3" />
          file content
          <span className="rounded bg-white/5 px-1 py-0.5 text-white/70">{lineCount} lines</span>
        </div>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap px-3 py-2 text-[10px] text-foreground/80">
          {preview}
          {lines.length > 120 ? '\n\n... (truncated in trace view)' : ''}
        </pre>
        {lines.length > 120 && (
          <details className="border-t border-white/5 px-3 py-1.5">
            <summary className="cursor-pointer text-[10px] text-white/50">Show full output</summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-[10px] text-foreground/80">
              {display}
            </pre>
          </details>
        )}
      </div>
    )
  }

  if (toolName === 'edit_file') {
    const stats = parseDiffStats(display)
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
          <IconFile className="h-3 w-3" />
          file diff
          <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-emerald-300">
            +{stats.added}
          </span>
          <span className="rounded bg-red-500/20 px-1 py-0.5 text-red-300">-{stats.removed}</span>
        </div>
        <details className="px-3 py-1.5" open={stats.added + stats.removed <= 20}>
          <summary className="cursor-pointer text-[10px] text-white/50">View diff</summary>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-[10px] text-foreground/80">
            {display}
          </pre>
        </details>
      </div>
    )
  }

  if (toolName === 'write_file') {
    const match = display.match(/^Wrote\s+(\d+)\s+bytes\s+to\s+(.+?)(?:\s+\(|$)/)
    const removed = display.match(/removed\s+(\d+)\s+control character/)
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
          <IconFile className="h-3 w-3" />
          file written
          {match?.[1] && (
            <span className="rounded bg-white/5 px-1 py-0.5 text-white/70">{match[1]} bytes</span>
          )}
          {removed?.[1] && (
            <span className="rounded bg-amber-500/20 px-1 py-0.5 text-amber-300">
              {removed[1]} control chars removed
            </span>
          )}
        </div>
        <div className="px-3 py-2 text-[10px] text-foreground/80">{match?.[2] ?? display}</div>
      </div>
    )
  }

  if (toolName === 'create_directory') {
    const dir = display.match(/^Created directory\s+(.+)$/m)?.[1] ?? display
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
          <IconFile className="h-3 w-3" />
          directory created
        </div>
        <div className="px-3 py-2 font-mono text-[10px] text-foreground/80">{dir}</div>
      </div>
    )
  }

  if (toolName === 'get_sprite_url') {
    const isEmpty = /No URL available/i.test(display)
    return (
      <div
        className={cn(
          'rounded-md border',
          isEmpty
            ? 'border-amber-500/20 bg-amber-500/[0.03]'
            : 'border-sky-500/20 bg-sky-500/[0.03]'
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2 border-b px-3 py-1.5 text-[10px] font-medium',
            isEmpty ? 'border-amber-500/10 text-amber-400' : 'border-sky-500/10 text-sky-400'
          )}
        >
          <IconHistory className="h-3 w-3" />
          sprite url
        </div>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[10px] text-foreground/80">
          {display}
        </pre>
      </div>
    )
  }

  if (
    toolName === 'list_sandboxes' ||
    toolName === 'list_schedule' ||
    toolName === 'list_background_tasks' ||
    toolName === 'list_services' ||
    toolName === 'list_runs' ||
    toolName === 'list_telegram_threads'
  ) {
    const lines = splitDisplayLines(display)
    const isNone = lines[0]?.toLowerCase().startsWith('no ') ?? false
    const preview = lines.slice(0, 18).join('\n')
    return (
      <div
        className={cn(
          'rounded-md border',
          isNone ? 'border-white/10 bg-white/[0.02]' : 'border-cyan-500/20 bg-cyan-500/[0.03]'
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2 border-b px-3 py-1.5 text-[10px] font-medium',
            isNone ? 'border-white/5 text-muted-foreground' : 'border-cyan-500/10 text-cyan-400'
          )}
        >
          <IconHistory className="h-3 w-3" />
          {toolName.replace(/_/g, ' ')}
          {!isNone && (
            <span className="rounded bg-cyan-500/15 px-1 py-0.5 text-cyan-300/80">
              {lines.length}
            </span>
          )}
        </div>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap px-3 py-2 text-[10px] text-foreground/80">
          {preview}
          {lines.length > 18 ? `\n\n... ${lines.length - 18} more` : ''}
        </pre>
      </div>
    )
  }

  if (toolName === 'get_self_config') {
    const lines = splitDisplayLines(display)
    return (
      <div className="rounded-md border border-violet-500/20 bg-violet-500/[0.03]">
        <div className="flex items-center gap-2 border-b border-violet-500/10 px-3 py-1.5 text-[10px] font-medium text-violet-300">
          <IconBrain className="h-3 w-3" />
          self config
        </div>
        <div className="space-y-1 px-3 py-2 text-[10px]">
          {lines.slice(0, 14).map((line, index) => {
            const [key, ...rest] = line.split(':')
            if (rest.length === 0) {
              return (
                <div key={index} className="text-foreground/80">
                  {line}
                </div>
              )
            }
            return (
              <div key={index} className="flex items-start gap-2">
                <span className="w-32 shrink-0 text-violet-200/70">{key}</span>
                <span className="min-w-0 break-all font-mono text-foreground/85">
                  {rest.join(':').trim()}
                </span>
              </div>
            )
          })}
        </div>
        {lines.length > 14 && (
          <details className="border-t border-violet-500/10 px-3 py-1.5">
            <summary className="cursor-pointer text-[10px] text-violet-200/70">
              Show full output
            </summary>
            <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap text-[10px] text-foreground/80">
              {display}
            </pre>
          </details>
        )}
      </div>
    )
  }

  if (
    toolName === 'schedule_check' ||
    toolName === 'cancel_scheduled' ||
    toolName === 'switch_sandbox' ||
    toolName === 'create_ephemeral_sandbox' ||
    toolName === 'delete_sandbox' ||
    toolName === 'configure_github_credentials' ||
    toolName === 'send_agent_message' ||
    toolName === 'download_attachment' ||
    toolName === 'send_telegram_message' ||
    toolName === 'send_file' ||
    toolName === 'refresh_network_policy' ||
    toolName === 'add_memory' ||
    toolName === 'remove_memory' ||
    toolName === 'update_memory' ||
    toolName === 'manage_service' ||
    toolName === 'create_service' ||
    toolName === 'start_background_task' ||
    toolName === 'stop_background_task'
  ) {
    const lines = splitDisplayLines(display)
    const headline = lines[0] ?? display
    const details = lines.slice(1).join('\n')
    const hasMore = details.length > 0
    const compactOneLine = !hasMore && headline.length <= 140

    if (compactOneLine) {
      return (
        <div className="rounded border border-emerald-500/20 bg-emerald-500/[0.03] px-2 py-1 text-[10px]">
          <div className="flex items-center gap-1.5 text-emerald-400">
            <IconCircleCheck className="h-3 w-3" />
            <span className="truncate text-foreground/85">{headline}</span>
            <span className="ml-auto shrink-0 text-emerald-300/60">
              {toolName.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      )
    }

    return (
      <div className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.03]">
        <div className="flex items-center gap-2 border-b border-emerald-500/10 px-3 py-1.5 text-[10px] font-medium text-emerald-400">
          <IconCircleCheck className="h-3 w-3" />
          {toolName.replace(/_/g, ' ')}
        </div>
        <div className="px-3 py-2 text-[10px] text-foreground/85">{headline}</div>
        {hasMore && (
          <details className="border-t border-emerald-500/10 px-3 py-1.5">
            <summary className="cursor-pointer text-[10px] text-emerald-300/70">Details</summary>
            <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap text-[10px] text-foreground/80">
              {details}
            </pre>
          </details>
        )}
      </div>
    )
  }

  if (
    toolName === 'query_activity' ||
    toolName === 'read_telegram_thread' ||
    toolName === 'run_todo' ||
    toolName === 'get_run' ||
    toolName === 'check_background_task' ||
    toolName === 'use_skill'
  ) {
    const lines = display.split('\n')
    const preview = lines.slice(0, 32).join('\n')
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
          <IconPointFilled className="h-3 w-3" />
          {toolName?.replace(/_/g, ' ')} result
        </div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 py-2 text-[10px] text-foreground/80">
          {preview}
          {lines.length > 32 ? '\n\n... (truncated in trace view)' : ''}
        </pre>
        {lines.length > 32 && (
          <details className="border-t border-white/5 px-3 py-1.5">
            <summary className="cursor-pointer text-[10px] text-white/50">Show full output</summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-[10px] text-foreground/80">
              {display}
            </pre>
          </details>
        )}
      </div>
    )
  }

  const lines = display.split('\n')
  const firstLine = lines.find((line) => line.trim().length > 0) ?? '(empty)'
  const hasMore = lines.length > 1 || display.length > 320

  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02]">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
        <IconPointFilled className="h-3 w-3" />
        {toolName ? `${toolName} result` : 'result'}
      </div>
      <div className="px-3 py-2 text-[10px] text-foreground/80">{firstLine}</div>
      {hasMore && (
        <details className="border-t border-white/5 px-3 py-1.5">
          <summary className="cursor-pointer text-[10px] text-white/50">Show full output</summary>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-[10px] text-foreground/80">
            {display}
          </pre>
        </details>
      )}
    </div>
  )
}

const roleStyles: Record<string, string> = {
  user: 'text-sky-400 border-sky-400/20 bg-sky-400/[0.04]',
  assistant: 'text-emerald-400 border-emerald-400/20 bg-emerald-400/[0.04]',
  tool: 'text-amber-400 border-amber-400/20 bg-amber-400/[0.04]',
  system: 'text-purple-400 border-purple-400/20 bg-purple-400/[0.04]',
}

const attachmentTypeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  audio: IconMusic,
  voice: IconMicrophone,
  video: IconVideo,
  video_note: IconVideo,
  animation: IconPhoto,
  sticker: IconPhoto,
  document: IconFile,
}

function parseAttachmentLines(text: string): { type: string; detail: string }[] {
  const matches = text.matchAll(/^Attachment \d+: (.+)$/gm)
  const result: { type: string; detail: string }[] = []
  for (const match of matches) {
    const line = match[1] ?? ''
    const typePart = line.split(' | ')[0]?.toLowerCase() ?? ''
    result.push({ type: typePart, detail: line })
  }
  return result
}

function CompactMessage({
  message,
  bgTaskIndicator,
  roleLabel,
  styleOverride,
  embedded = false,
  defaultUserLabel,
  toolCallStatusMap,
}: {
  message: Message
  bgTaskIndicator?: boolean
  roleLabel?: string
  styleOverride?: string
  embedded?: boolean
  defaultUserLabel?: string
  toolCallStatusMap?: Map<string, 'pending' | 'ok' | 'error'>
}) {
  const [expanded, setExpanded] = useState(false)
  const [expandedReasoningByIndex, setExpandedReasoningByIndex] = useState<Record<number, boolean>>(
    {}
  )
  let displayContent = ''
  let reasoningSegments: string[] = []
  let toolCalls: ParsedToolCall[] = []
  const imageUrls = message.role === 'user' ? extractImageUrls(message) : []

  if (message.role === 'assistant') {
    const parsed = parseStoredMessagePayload(message.content)
    displayContent = parsed.text
    reasoningSegments = parsed.reasoningSegments
    toolCalls = parsed.toolCalls
  } else if (message.content) {
    try {
      const parsed = JSON.parse(message.content) as { text?: string; content?: string }
      displayContent = parsed.text ?? parsed.content ?? message.content
    } catch {
      displayContent = message.content
    }
  }

  const attachmentLines = message.role === 'user' ? parseAttachmentLines(displayContent) : []
  const nonImageAttachments = attachmentLines.filter(
    (a) => a.type !== 'photo' && a.type !== 'image'
  )
  const inferredUserLabel =
    roleLabel == null && message.role === 'user'
      ? (getHumanSenderLabelFromContent(displayContent) ?? defaultUserLabel ?? null)
      : null

  const isLong = displayContent.length > 300
  const preview = isLong && !expanded ? `${displayContent.slice(0, 300)}...` : displayContent

  return (
    <div
      className={cn(
        embedded ? 'p-0' : 'rounded-md border p-2',
        !embedded &&
          (bgTaskIndicator
            ? 'border-cyan-400/20 bg-cyan-400/[0.04] text-cyan-400'
            : (styleOverride ?? roleStyles[message.role] ?? roleStyles.system))
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider">
          {bgTaskIndicator && <IconTerminal2 className="mr-1 inline h-3 w-3 text-cyan-400/70" />}
          {roleLabel ?? inferredUserLabel ?? message.role}
          {imageUrls.length > 0 && <IconPhoto className="ml-1 inline h-3 w-3 text-sky-400/50" />}
          {nonImageAttachments.length > 0 && imageUrls.length === 0 && (
            <IconPaperclip className="ml-1 inline h-3 w-3 text-sky-400/50" />
          )}
        </span>
        <span className="text-[9px] text-white/20">
          {new Date(message.created_at * 1000).toLocaleTimeString([], { hour12: false })}
        </span>
      </div>
      {reasoningSegments.map((reasoning, index) => {
        const reasoningIsLong = reasoning.length > 300
        const isExpanded = expandedReasoningByIndex[index] === true
        const reasoningPreview =
          reasoningIsLong && !isExpanded ? `${reasoning.slice(0, 300)}...` : reasoning

        return (
          <div
            key={`${message.id}-reasoning-${index}`}
            className="mb-3 rounded border border-blue-400/20 bg-blue-400/[0.03] p-2"
          >
            <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-blue-300">
              <IconBrain className="h-3 w-3" />
              {reasoningSegments.length > 1 ? `reasoning ${index + 1}` : 'reasoning'}
            </div>
            <pre className="whitespace-pre-wrap text-[10px] text-foreground/70">
              {reasoningPreview}
            </pre>
            {reasoningIsLong && (
              <button
                onClick={() =>
                  setExpandedReasoningByIndex((prev) => ({
                    ...prev,
                    [index]: !isExpanded,
                  }))
                }
                className="mt-1 text-[10px] text-white/30 hover:text-white/60"
              >
                {isExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )
      })}
      {displayContent && (
        <>
          <pre className="whitespace-pre-wrap text-[10px] text-foreground/70">{preview}</pre>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1 text-[10px] text-white/30 hover:text-white/60"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </>
      )}
      {toolCalls.length > 0 && (
        <div className="space-y-1">
          {toolCalls.map((tc) => {
            let args: unknown
            try {
              args = JSON.parse(tc.function?.arguments ?? '{}')
            } catch {
              args = tc.function?.arguments
            }
            const tcStatus = tc.id && toolCallStatusMap ? toolCallStatusMap.get(tc.id) : undefined
            const isError = tcStatus === 'error'
            const isPending = tcStatus === 'pending'
            const highlights = buildToolArgHighlights(tc.function?.name ?? 'unknown', args)
            const rawArgs = typeof args === 'string' ? args : JSON.stringify(args, null, 2)
            const showRawInput = rawArgs.length > 180 || highlights.length === 0
            return (
              <div
                key={tc.id}
                className={cn(
                  'rounded border',
                  isError
                    ? 'border-red-500/20 bg-red-500/[0.03]'
                    : 'border-amber-500/20 bg-amber-500/[0.03]'
                )}
              >
                <div
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium',
                    isError ? 'text-red-400' : 'text-amber-400'
                  )}
                >
                  <IconTool className="h-3 w-3" />
                  {tc.function?.name ?? 'unknown'}
                  <span className="text-white/30">call</span>
                  {isPending && (
                    <span className="flex items-center gap-0.5 rounded bg-amber-500/20 px-1 py-0.5 text-[9px] text-amber-300">
                      <IconRefresh className="h-2.5 w-2.5 animate-spin" />
                      running
                    </span>
                  )}
                  {tcStatus === 'ok' && <IconCircleCheck className="h-3 w-3 text-emerald-500/60" />}
                  {isError && (
                    <span className="flex items-center gap-0.5 rounded bg-red-500/20 px-1 py-0.5 text-[9px]">
                      <IconAlertTriangle className="h-2.5 w-2.5" />
                      failed
                    </span>
                  )}
                </div>
                {highlights.length > 0 && (
                  <div className="flex flex-wrap gap-1 px-2 pb-1 text-[10px]">
                    {highlights.slice(0, 3).map((item) => (
                      <span
                        key={item.label}
                        className="rounded border border-white/10 bg-white/[0.04] px-1 py-0.5"
                      >
                        <span className="text-white/45">{item.label}</span>
                        <span className="mx-0.5 text-white/30">=</span>
                        <span className="font-mono text-foreground/80">{item.value}</span>
                      </span>
                    ))}
                  </div>
                )}
                {showRawInput && (
                  <details className="border-t border-white/10 px-2 py-1">
                    <summary className="cursor-pointer text-[10px] text-white/45">input</summary>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-foreground/75">
                      {rawArgs}
                    </pre>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      )}
      {imageUrls.length > 0 && (
        <div className="mt-2">
          <ImageGallery images={imageUrls} />
        </div>
      )}
      {nonImageAttachments.length > 0 && (
        <div className="mt-2 space-y-1">
          {nonImageAttachments.map((att, i) => {
            const TypeIcon = attachmentTypeIcons[att.type] || IconFile
            return (
              <div key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <TypeIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">{att.detail}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Session history (collapsed between system and user messages)
// ---------------------------------------------------------------------------

function getPromptHistoryText(message: PromptHistoryMessage): string {
  if (!message.content) return ''
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''

  const parts = message.content.map((part) => {
    if (part.type === 'text') return part.text ?? ''
    if (part.type === 'image_url') return '[image input]'
    if (part.type === 'refusal') return part.refusal ?? '[model refusal]'
    return ''
  })
  return parts.filter(Boolean).join('\n')
}

function getPromptHistoryImages(message: PromptHistoryMessage): string[] {
  if (!Array.isArray(message.content)) return []
  return message.content
    .filter((part) => part.type === 'image_url' && part.image_url?.url)
    .map((part) => part.image_url!.url)
}

const SESSION_HISTORY_EXPAND_STEP = 5
const SESSION_HISTORY_PREVIEW_COUNT = SESSION_HISTORY_EXPAND_STEP

function SessionHistorySection({
  history,
  scrollContainerRef,
  agentByHandle = {},
  defaultUserLabel,
  applyDefaultUserLabel = false,
}: {
  history: PromptSessionHistory
  scrollContainerRef?: ScrollContainerRef
  agentByHandle?: AgentIdentityByHandle
  defaultUserLabel?: string
  applyDefaultUserLabel?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(() =>
    Math.min(SESSION_HISTORY_PREVIEW_COUNT, history.messages.length)
  )
  const boundaryRef = useRef<HTMLDivElement>(null)
  const newestVisibleRef = useRef<HTMLDivElement>(null)
  const pendingBoundaryIndexRef = useRef<number | null>(null)

  const total = history.messages.length
  const effectiveVisibleCount = Math.min(visibleCount, total)
  const hiddenCount = Math.max(0, total - effectiveVisibleCount)
  const hasHidden = hiddenCount > 0

  useEffect(() => {
    setVisibleCount(Math.min(SESSION_HISTORY_PREVIEW_COUNT, total))
    pendingBoundaryIndexRef.current = null
  }, [total])

  const visibleMessages = history.messages.slice(hiddenCount)
  const visibleOffset = hiddenCount

  const scrollElementIntoView = useCallback(
    (target: HTMLElement | null) => {
      if (!target) return
      const scrollParent = scrollContainerRef?.current
      if (!scrollParent) {
        target.scrollIntoView({ block: 'end' })
        return
      }
      const containerRect = scrollParent.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      if (targetRect.bottom <= containerRect.bottom && targetRect.top >= containerRect.top) return
      const targetScrollTop =
        scrollParent.scrollTop + (targetRect.bottom - containerRect.bottom) + 8
      const maxScrollTop = Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight)
      scrollParent.scrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop))
    },
    [scrollContainerRef]
  )

  const scrollBoundaryIntoView = useCallback(() => {
    if (pendingBoundaryIndexRef.current === null) return
    const boundary = boundaryRef.current
    if (!boundary) return
    scrollElementIntoView(boundary)
    pendingBoundaryIndexRef.current = null
  }, [scrollElementIntoView])

  const handleToggleOpen = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev
      if (next) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            scrollElementIntoView(newestVisibleRef.current)
          })
        })
      }
      return next
    })
  }, [scrollElementIntoView])

  const expandBy = useCallback(
    (count: number) => {
      setVisibleCount((prevVisibleCount) => {
        const prevCount = Math.min(prevVisibleCount, total)
        const prevStart = Math.max(0, total - prevCount)
        const nextCount = Math.min(total, prevCount + count)
        const nextStart = Math.max(0, total - nextCount)

        if (nextStart < prevStart) {
          pendingBoundaryIndexRef.current = prevStart - 1
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              scrollBoundaryIntoView()
            })
          })
        }

        return nextCount
      })
    },
    [scrollBoundaryIntoView, total]
  )

  const handleShowMore = useCallback(() => {
    expandBy(SESSION_HISTORY_EXPAND_STEP)
  }, [expandBy])

  const handleShowAll = useCallback(() => {
    expandBy(total)
  }, [expandBy, total])

  if (total === 0) return null

  return (
    <div className="rounded-md border border-violet-400/20 bg-violet-400/[0.04]">
      <button
        onClick={handleToggleOpen}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-violet-400"
      >
        <span
          className="transition-transform"
          style={{ transform: isOpen ? 'rotate(90deg)' : undefined }}
        >
          &#9654;
        </span>
        <IconHistory className="h-3 w-3" />
        <span>
          Session History In Prompt ({history.turnCount} turns, {total} messages, ~
          {history.totalTokens.toLocaleString()} tokens
          {history.truncated ? ', truncated' : ''})
        </span>
      </button>
      {isOpen && (
        <div className="space-y-2 border-t border-violet-400/10 px-3 py-2">
          {history.truncated && (
            <div className="rounded-md border border-violet-400/20 bg-violet-400/[0.06] px-2 py-1 text-[10px] text-violet-300/80">
              Older history was omitted to fit session context limits.
            </div>
          )}
          {hasHidden && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={handleShowMore}
                className="rounded-md border border-violet-400/15 bg-violet-400/[0.06] px-2 py-1.5 text-[10px] text-violet-300/80 transition-colors hover:bg-violet-400/[0.12] hover:text-violet-300"
              >
                Show {Math.min(SESSION_HISTORY_EXPAND_STEP, hiddenCount)} older message
                {Math.min(SESSION_HISTORY_EXPAND_STEP, hiddenCount) === 1 ? '' : 's'}
              </button>
              {hiddenCount > SESSION_HISTORY_EXPAND_STEP && (
                <button
                  onClick={handleShowAll}
                  className="rounded-md border border-violet-400/15 bg-transparent px-2 py-1.5 text-[10px] text-violet-300/70 transition-colors hover:bg-violet-400/[0.08] hover:text-violet-300"
                >
                  Show all {total}
                </button>
              )}
            </div>
          )}
          {visibleMessages.map((msg, index) => {
            const globalIndex = visibleOffset + index
            const isBoundary = pendingBoundaryIndexRef.current === globalIndex
            const isNewestVisible = globalIndex === total - 1
            return (
              <div
                key={`${msg.role}-${globalIndex}`}
                ref={isBoundary ? boundaryRef : isNewestVisible ? newestVisibleRef : undefined}
              >
                <SessionHistoryMessageCard
                  message={msg}
                  index={globalIndex + 1}
                  agentByHandle={agentByHandle}
                  defaultUserLabel={defaultUserLabel}
                  applyDefaultUserLabel={applyDefaultUserLabel}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const promptHistoryRoleStyles: Record<string, string> = {
  system: 'text-violet-300/80 border-violet-300/20 bg-violet-300/[0.03]',
  user: 'text-sky-400/70 border-sky-400/10 bg-sky-400/[0.02]',
  assistant: 'text-emerald-400/70 border-emerald-400/10 bg-emerald-400/[0.02]',
  tool: 'text-amber-400/70 border-amber-400/10 bg-amber-400/[0.02]',
}

const attributedSessionHistoryRoleStyle =
  'text-indigo-400/80 border-indigo-400/20 bg-indigo-400/[0.03]'
const ATTRIBUTED_AGENT_PREFIX = /^\[@([a-z0-9._-]+)\]:\s*/i
const USER_FROM_CONTEXT_REGEX = /\[From:\s*([^\]|]+(?:\s+@[^\s\]|]+)?)\s*(?:\|[^\]]*)?\]/i

function parseAttributedHistoryMessage(text: string): { handle: string | null; content: string } {
  const match = text.match(ATTRIBUTED_AGENT_PREFIX)
  if (!match?.[0] || !match[1]) return { handle: null, content: text }
  return {
    handle: match[1].toLowerCase(),
    content: text.slice(match[0].length),
  }
}

function getHumanSenderLabelFromContent(text: string): string | null {
  const sender = text.match(USER_FROM_CONTEXT_REGEX)?.[1]?.trim()
  if (!sender) return null
  return `👤 ${sender}`
}

function SessionHistoryMessageCard({
  message,
  index,
  agentByHandle = {},
  defaultUserLabel,
  applyDefaultUserLabel = false,
}: {
  message: PromptHistoryMessage
  index: number
  agentByHandle?: AgentIdentityByHandle
  defaultUserLabel?: string
  applyDefaultUserLabel?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const rawDisplayContent = getPromptHistoryText(message)
  const { handle: attributedHandle, content: displayContent } =
    parseAttributedHistoryMessage(rawDisplayContent)
  const attributedAgent = attributedHandle ? agentByHandle[attributedHandle] : undefined
  const humanSenderLabel = getHumanSenderLabelFromContent(displayContent)
  const roleLabel =
    message.role === 'user' && attributedHandle
      ? `${attributedAgent?.emoji ?? ''} ${attributedAgent?.name ?? `@${attributedHandle}`}`.trim()
      : message.role === 'user' && humanSenderLabel
        ? humanSenderLabel
        : message.role === 'user' && applyDefaultUserLabel && defaultUserLabel
          ? defaultUserLabel
          : message.role
  const imageUrls = getPromptHistoryImages(message)
  const toolCalls =
    message.role === 'assistant' && Array.isArray(message.tool_calls) ? message.tool_calls : []

  const isLong = displayContent.length > 200
  const preview = isLong && !expanded ? `${displayContent.slice(0, 200)}...` : displayContent

  const roleStyle =
    message.role === 'user' && attributedHandle
      ? attributedSessionHistoryRoleStyle
      : (promptHistoryRoleStyles[message.role] ?? promptHistoryRoleStyles.system)

  return (
    <div className={cn('rounded-md border p-2', roleStyle)}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[9px] font-medium uppercase tracking-wider opacity-70">
          {index}. {roleLabel}
        </span>
        {toolCalls.length > 0 && (
          <span className="text-[9px] text-white/30">{toolCalls.length} tool call(s)</span>
        )}
      </div>
      {preview && (
        <pre className="whitespace-pre-wrap text-[10px] text-foreground/50">{preview}</pre>
      )}
      {!preview && toolCalls.length === 0 && (
        <div className="text-[10px] text-white/30">[no text content]</div>
      )}
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[10px] text-white/20 hover:text-white/50"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
      {toolCalls.length > 0 && (
        <div className="mt-2 space-y-1">
          {toolCalls.map((toolCall, i) => (
            <div
              key={`${toolCall.id}-${i}`}
              className="rounded border border-white/10 bg-white/[0.02] p-1.5"
            >
              <div className="text-[9px] font-mono text-amber-300/80">
                {(toolCall.function?.name ?? 'unknown_tool').trim()}
              </div>
              {toolCall.function?.arguments && (
                <pre className="mt-1 whitespace-pre-wrap text-[9px] text-foreground/45">
                  {toolCall.function.arguments.length > 200
                    ? `${toolCall.function.arguments.slice(0, 200)}...`
                    : toolCall.function.arguments}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
      {message.role === 'tool' && message.tool_call_id && (
        <div className="mt-1 font-mono text-[9px] text-white/35">
          tool_call_id: {message.tool_call_id}
        </div>
      )}
      {imageUrls.length > 0 && (
        <div className="mt-2">
          <ImageGallery images={imageUrls} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overview panel (no span selected)
// ---------------------------------------------------------------------------

function OverviewPanel({
  messages,
  allSpans = [],
  sessionHistory = EMPTY_PROMPT_SESSION_HISTORY,
  siblingMessages = [],
  agentByHandle = {},
  assistantLabel,
  defaultUserLabel,
  applyDefaultUserLabelToHistory = false,
  externalApiCalls = [],
  mediaArtifacts = [],
  backgroundTasks = [],
}: {
  messages: Message[]
  allSpans?: Span[]
  sessionHistory?: PromptSessionHistory
  siblingMessages?: SiblingMessage[]
  agentByHandle?: AgentIdentityByHandle
  assistantLabel?: string
  defaultUserLabel?: string
  applyDefaultUserLabelToHistory?: boolean
  externalApiCalls?: ExternalApiCallInfo[]
  mediaArtifacts?: TraceMediaArtifactInfo[]
  backgroundTasks?: BackgroundTaskInfo[]
}) {
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const bgMap = buildBackgroundTaskMap(messages, backgroundTasks)
  const toolCallNameMap = useMemo(() => buildToolCallNameMap(allSpans), [allSpans])
  const mediaArtifactsById = useMemo(
    () => new Map(mediaArtifacts.map((artifact) => [artifact.id, artifact])),
    [mediaArtifacts]
  )

  // Split: system | session history | user prompt | sibling replies | agent responses
  const systemMessages = messages.filter((m) => m.role === 'system')
  const restMessages = messages.filter((m) => m.role !== 'system')
  const firstNonUserIdx = restMessages.findIndex((m) => m.role !== 'user')
  const userPromptMessages =
    firstNonUserIdx === -1 ? restMessages : restMessages.slice(0, firstNonUserIdx)
  const agentResponses = useMemo(
    () => (firstNonUserIdx === -1 ? [] : restMessages.slice(firstNonUserIdx)),
    [firstNonUserIdx, restMessages]
  )
  const agentResponseBlocks = useMemo(
    () => buildAgentResponseBlocks(agentResponses),
    [agentResponses]
  )

  return (
    <div className="flex flex-col">
      <div className="border-b border-white/5 px-4 py-3">
        <h4 className="text-sm font-semibold">Messages</h4>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          Select a span on the left to view details.
        </p>
      </div>
      <div ref={bodyScrollRef} className="px-4 py-3">
        <div className="space-y-2">
          {systemMessages.map((msg) => (
            <CompactMessage key={msg.id} message={msg} />
          ))}
          {sessionHistory.messages.length > 0 && (
            <SessionHistorySection
              history={sessionHistory}
              scrollContainerRef={bodyScrollRef}
              agentByHandle={agentByHandle}
              defaultUserLabel={defaultUserLabel}
              applyDefaultUserLabel={applyDefaultUserLabelToHistory}
            />
          )}
          {userPromptMessages.map((msg) => (
            <MessageOrBackgroundTask
              key={msg.id}
              message={msg}
              backgroundTaskMap={bgMap}
              toolCallNameMap={toolCallNameMap}
              externalApiCalls={externalApiCalls}
              mediaArtifacts={mediaArtifacts}
              mediaArtifactsById={mediaArtifactsById}
              defaultUserLabel={defaultUserLabel}
            />
          ))}
          {siblingMessages.map((msg) => (
            <CompactMessage
              key={msg.id}
              message={msg}
              roleLabel={`${msg.agentEmoji ?? ''} ${msg.agentName}`.trim()}
              styleOverride="text-indigo-400 border-indigo-400/20 bg-indigo-400/[0.04]"
            />
          ))}
          {agentResponseBlocks.map((block) =>
            block.kind === 'assistant-tool-exchange' ? (
              <AssistantToolExchange
                key={`exchange-${block.assistant.id}`}
                assistantMessage={block.assistant}
                toolResultMessages={block.toolResults}
                toolCallNameMap={toolCallNameMap}
                backgroundTaskMap={bgMap}
                externalApiCalls={externalApiCalls}
                mediaArtifacts={mediaArtifacts}
                mediaArtifactsById={mediaArtifactsById}
                defaultUserLabel={defaultUserLabel}
                assistantLabel={assistantLabel}
              />
            ) : (
              <MessageOrBackgroundTask
                key={block.message.id}
                message={block.message}
                backgroundTaskMap={bgMap}
                toolCallNameMap={toolCallNameMap}
                externalApiCalls={externalApiCalls}
                mediaArtifacts={mediaArtifacts}
                mediaArtifactsById={mediaArtifactsById}
                defaultUserLabel={defaultUserLabel}
                assistantLabel={assistantLabel}
              />
            )
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main TraceView
// ---------------------------------------------------------------------------

export function TraceView({
  spans,
  messages,
  inferenceCalls = [],
  runStatus,
  sessionHistory = EMPTY_PROMPT_SESSION_HISTORY,
  siblingMessages = [],
  agentByHandle = {},
  agentLabel,
  defaultUserLabel,
  applyDefaultUserLabelToHistory = false,
  externalApiCalls = [],
  mediaArtifacts = [],
  modelCatalog = [],
  backgroundTasks = [],
}: TraceViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [treeMode, setTreeMode] = useState<TraceTreeMode>('tool-first')
  const runActive = runStatus === 'PENDING' || runStatus === 'RUNNING' || runStatus === 'PAUSED'

  const tree = buildTree(spans)
  const displayRows = useMemo(() => buildDisplayRows(tree, treeMode), [tree, treeMode])
  const visibleIds = useMemo(() => new Set(displayRows.map((row) => row.span.id)), [displayRows])
  const timelineStart = Math.min(...spans.map((s) => s.start_time))
  const timelineEnd = Math.max(
    ...spans.map((s) => s.end_time ?? s.start_time + (s.duration_ms ?? 0))
  )
  const timelineRange = timelineEnd - timelineStart || 1

  useEffect(() => {
    if (selectedId && !visibleIds.has(selectedId)) {
      setSelectedId(null)
    }
  }, [selectedId, visibleIds])

  const selectedSpan = selectedId ? (spans.find((s) => s.id === selectedId) ?? null) : null
  const {
    ids: spanIdsWithAttachments,
    hasImages,
    hasOtherAttachments,
  } = getSpanIdsWithAttachments(messages, spans)
  const AttachmentIndicatorIcon =
    hasImages && hasOtherAttachments
      ? IconPaperclip
      : hasImages
        ? IconPhoto
        : hasOtherAttachments
          ? IconPaperclip
          : undefined

  // Summary stats for header
  const jobSpan = spans.find((s) => s.name === 'job')
  const turnCount = spans.filter((s) => s.name === 'turn').length
  const toolCount = spans.filter((s) => s.name === 'tool_exec').length
  const errorCount = spans.filter((s) => s.status === 'error').length
  const modelCalls = spans.filter((s) => s.name === 'model_call')
  const totalInference = modelCalls.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0)
  const totalToolTime = spans
    .filter((s) => s.name === 'tool_exec')
    .reduce((sum, s) => sum + (s.duration_ms ?? 0), 0)
  const totalExternalCost = externalApiCalls.reduce((sum, c) => sum + (c.cost_usd ?? 0), 0)
  const unknownExternalCount = externalApiCalls.filter((call) => call.cost_usd == null).length

  return (
    <div className="flex flex-col rounded-b-lg border border-t-0 border-white/10 bg-white/[0.01]">
      {/* ---- Top bar with summary stats ---- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/5 px-4 py-2 text-[10px] text-muted-foreground">
        <span className="text-xs font-medium text-foreground">Execution Trace</span>
        <div className="inline-flex overflow-hidden rounded border border-white/10">
          <button
            onClick={() => setTreeMode('tool-first')}
            className={cn(
              'px-2 py-0.5 text-[10px] transition-colors',
              treeMode === 'tool-first'
                ? 'bg-white/[0.08] text-foreground'
                : 'bg-transparent text-white/50 hover:text-white/75'
            )}
          >
            Tool-first
          </button>
          <button
            onClick={() => setTreeMode('raw')}
            className={cn(
              'border-l border-white/10 px-2 py-0.5 text-[10px] transition-colors',
              treeMode === 'raw'
                ? 'bg-white/[0.08] text-foreground'
                : 'bg-transparent text-white/50 hover:text-white/75'
            )}
          >
            Raw
          </button>
        </div>
        {treeMode === 'tool-first' && (
          <span className="text-white/35">
            showing {displayRows.length}/{spans.length} span rows
          </span>
        )}
        {jobSpan && (
          <span className="flex items-center gap-1 tabular-nums">
            <IconClock className="h-3 w-3" />
            {formatDuration(jobSpan.duration_ms, runActive)}
          </span>
        )}
        <span className="tabular-nums">{turnCount} turns</span>
        <span className="tabular-nums">{toolCount} tools</span>
        {errorCount > 0 && (
          <span className="flex items-center gap-1 text-red-400">
            <IconAlertTriangle className="h-3 w-3" />
            {errorCount} error{errorCount !== 1 ? 's' : ''}
          </span>
        )}
        <span className="tabular-nums">{messages.length} messages</span>
        <span className="text-white/20">·</span>
        <span className="tabular-nums">
          <IconBrain className="mr-0.5 inline h-3 w-3" />
          {formatDuration(totalInference, runActive)}
        </span>
        <span className="tabular-nums">
          <IconTool className="mr-0.5 inline h-3 w-3" />
          {formatDuration(totalToolTime, runActive)}
        </span>
        {externalApiCalls.length > 0 && (
          <span
            className={cn(
              'tabular-nums',
              unknownExternalCount > 0 ? 'text-amber-300' : 'text-emerald-400'
            )}
          >
            {totalExternalCost > 0 ? formatCost(totalExternalCost) : 'unpriced'} ext
            {unknownExternalCount > 0 ? ` (${unknownExternalCount} unpriced)` : ''}
          </span>
        )}
      </div>

      {/* ---- Two-panel layout ---- */}
      <div className="flex max-h-[80vh] overflow-hidden">
        {/* Left: span tree */}
        <ScrollFadePanel className="w-80 shrink-0 border-r border-white/5 lg:w-96">
          <div className="py-1">
            {displayRows.map((node) => (
              <SpanTreeRow
                key={node.span.id}
                node={node}
                timelineStart={timelineStart}
                timelineRange={timelineRange}
                runActive={runActive}
                selectedId={selectedId}
                onSelect={setSelectedId}
                modelCatalog={modelCatalog}
                hasAttachments={spanIdsWithAttachments.has(node.span.id)}
                attachmentIcon={AttachmentIndicatorIcon}
              />
            ))}
          </div>
        </ScrollFadePanel>

        {/* Right: detail — auto-scroll to bottom so latest activity is visible */}
        <ScrollFadePanel className="min-w-0 flex-1" autoScrollToBottom>
          {selectedSpan ? (
            <DetailPanel
              span={selectedSpan}
              messages={messages}
              allSpans={spans}
              inferenceCalls={inferenceCalls}
              runActive={runActive}
              sessionHistory={sessionHistory}
              siblingMessages={siblingMessages}
              agentByHandle={agentByHandle}
              assistantLabel={agentLabel}
              defaultUserLabel={defaultUserLabel}
              applyDefaultUserLabelToHistory={applyDefaultUserLabelToHistory}
              externalApiCalls={externalApiCalls}
              mediaArtifacts={mediaArtifacts}
              modelCatalog={modelCatalog}
              backgroundTasks={backgroundTasks}
            />
          ) : (
            <OverviewPanel
              messages={messages}
              allSpans={spans}
              sessionHistory={sessionHistory}
              siblingMessages={siblingMessages}
              agentByHandle={agentByHandle}
              assistantLabel={agentLabel}
              defaultUserLabel={defaultUserLabel}
              applyDefaultUserLabelToHistory={applyDefaultUserLabelToHistory}
              externalApiCalls={externalApiCalls}
              mediaArtifacts={mediaArtifacts}
              backgroundTasks={backgroundTasks}
            />
          )}
        </ScrollFadePanel>
      </div>
    </div>
  )
}
