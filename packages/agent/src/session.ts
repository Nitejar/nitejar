import type OpenAI from 'openai'
import {
  listMessagesBySession,
  getLastSessionMessageTime,
  findLatestSessionSummary,
  createSessionSummary,
  deleteNonPermanentMemoriesByAgent,
  type SessionMessage,
} from '@nitejar/database'
import { closeSpriteSessionForConversation } from '@nitejar/sprites'
import type { SessionSettings, CompactionSettings } from './types'
import { DEFAULT_SESSION_SETTINGS, DEFAULT_COMPACTION_SETTINGS } from './config'
import { sanitize, sanitizeLabel, wrapBoundary } from './prompt-sanitize'

/**
 * A single conversation turn (user message + assistant response) — used for compaction summaries.
 */
export interface ConversationTurn {
  userMessage: string
  assistantResponse: string
  timestamp: number
}

/**
 * A group of OpenAI messages forming one conversation turn.
 * Starts with a user message, followed by assistant messages (possibly with
 * tool_calls) and tool result messages, exactly as they appeared during the
 * original inference loop.
 */
export type TurnGroup = OpenAI.ChatCompletionMessageParam[]

interface RelayAgentLine {
  source: 'handle' | 'display'
  payloadNormalized: string
}

/**
 * Session context containing conversation history
 */
export interface SessionContext {
  /** Previous conversation as OpenAI-format messages, grouped by user turn */
  turnGroups: TurnGroup[]
  /** Total estimated tokens in the context */
  totalTokens: number
  /** Whether older messages were truncated */
  truncated: boolean
  /** Summary from previous session (if any) */
  previousSummary: string | null
  /** Whether the session was reset (by trigger or timeout) */
  wasReset: boolean
}

/**
 * Estimate token count for a string (rough heuristic: 4 chars ≈ 1 token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Calculate the session cutoff timestamp based on daily reset hour
 */
export function calculateSessionCutoff(
  dailyResetHour: number | null,
  referenceTimestamp: number = Math.floor(Date.now() / 1000)
): number | null {
  if (dailyResetHour === null) return null

  const now = new Date(referenceTimestamp * 1000)
  const resetToday = new Date(now)
  resetToday.setHours(dailyResetHour, 0, 0, 0)

  // If reset hour hasn't happened today, use yesterday's
  if (resetToday > now) {
    resetToday.setDate(resetToday.getDate() - 1)
  }

  return Math.floor(resetToday.getTime() / 1000)
}

/**
 * Check if the session has expired due to idle timeout
 */
export function isSessionExpired(lastMessageTime: number, idleTimeoutMinutes: number): boolean {
  const now = Math.floor(Date.now() / 1000)
  const idleSeconds = now - lastMessageTime
  return idleSeconds > idleTimeoutMinutes * 60
}

/**
 * Check if a message contains a reset trigger
 */
function containsResetTrigger(message: string, triggers: string[]): boolean {
  const normalizedMessage = message.toLowerCase().trim()
  return triggers.some((trigger) => normalizedMessage.startsWith(trigger.toLowerCase()))
}

/**
 * Parse message content to extract text.
 * Messages are stored as JSON objects with a 'text' field.
 */
function parseMessageText(content: string | null): string {
  if (!content) return ''

  try {
    const parsed: unknown = JSON.parse(content)
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const text = typeof record.text === 'string' ? record.text : null
      const alt = typeof record.content === 'string' ? record.content : null
      return text ?? alt ?? ''
    }
    return ''
  } catch {
    return content
  }
}

/**
 * Convert a stored DB message to an OpenAI-format message.
 * Returns null for messages that should be skipped (system prompts, empty content).
 *
 * When currentAgentId is provided, messages from other agents are attributed:
 * - Other agents' assistant text is prefixed with [@handle]
 * - Other agents' tool calls and tool results are skipped (avoids context bloat)
 */
export function toOpenAIMessage(
  msg: SessionMessage,
  currentAgentId?: string
): OpenAI.ChatCompletionMessageParam | null {
  const isOtherAgent = currentAgentId != null && msg.agentId !== currentAgentId

  // System prompts are regenerated each run — skip them
  if (msg.role === 'system') return null

  // Skip other agents' user messages and tool results early, before general role handling.
  // User messages are duplicates (same message stored per-job), tool results are noise.
  if (isOtherAgent && msg.role === 'user') return null
  if (isOtherAgent && msg.role === 'tool') return null

  if (msg.role === 'user') {
    // Check for multimodal content (images stored as content_parts)
    try {
      const parsed = JSON.parse(msg.content || '{}') as {
        text?: string
        content_parts?: OpenAI.ChatCompletionContentPart[]
      }
      if (Array.isArray(parsed.content_parts) && parsed.content_parts.length > 0) {
        return { role: 'user', content: parsed.content_parts }
      }
    } catch {
      /* fall through to text-only */
    }
    const text = parseMessageText(msg.content)
    return text ? { role: 'user', content: sanitize(text) } : null
  }

  if (msg.role === 'tool') {
    try {
      const parsed = JSON.parse(msg.content || '{}') as Record<string, unknown>
      const toolCallId = typeof parsed.tool_call_id === 'string' ? parsed.tool_call_id : ''
      const content =
        typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content ?? '')
      if (!toolCallId) return null
      return { role: 'tool' as const, tool_call_id: toolCallId, content: sanitize(content) }
    } catch {
      return null
    }
  }

  if (msg.role === 'assistant') {
    try {
      const parsed = JSON.parse(msg.content || '{}') as Record<string, unknown>
      const text = typeof parsed.text === 'string' ? parsed.text : undefined
      const toolCalls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : undefined

      if (isOtherAgent) {
        // For other agents: inject as a user-role message so the model doesn't
        // confuse it with its own previous output. Clear attribution ensures
        // the agent knows who said it.
        if (!text) return null
        const safeHandle = sanitizeLabel(msg.agentHandle ?? '', 'agent')
        const attributed = `[@${safeHandle}]: ${sanitize(text)}`
        return { role: 'user', content: attributed }
      }

      if (!text && !toolCalls) return null

      const message: OpenAI.ChatCompletionAssistantMessageParam = { role: 'assistant' }
      if (text) {
        const sanitizedText = sanitize(text)
        // For final-mode jobs: distinguish private reasoning from the posted response
        if (parsed.is_final_response === true) {
          message.content = `[Your response to the user]: ${sanitizedText}`
        } else if (msg.jobHasFinalResponse && !toolCalls) {
          // Text-only intermediate message in a final-mode job — internal reasoning
          message.content = `[Your internal reasoning — not visible to user]: ${sanitizedText}`
        } else {
          message.content = sanitizedText
        }
      }
      if (toolCalls) {
        message.tool_calls = toolCalls as OpenAI.ChatCompletionMessageToolCall[]
      }
      return message
    } catch {
      return null
    }
  }

  return null
}

/**
 * Group DB messages into turn groups.
 * Each group starts with a user message and includes all subsequent
 * assistant and tool messages until the next user message.
 * Messages are converted to OpenAI format exactly as they appeared
 * during the original inference loop.
 */
export function groupIntoTurnGroups(
  messages: SessionMessage[],
  currentAgentId?: string
): TurnGroup[] {
  const dedupedMessages: OpenAI.ChatCompletionMessageParam[] = []

  const groups: TurnGroup[] = []
  let currentGroup: OpenAI.ChatCompletionMessageParam[] = []

  for (const msg of messages) {
    const openAIMsg = toOpenAIMessage(msg, currentAgentId)
    if (!openAIMsg) continue

    const previous = dedupedMessages[dedupedMessages.length - 1]
    if (previous) {
      const dedupeDecision = dedupeRelayEchoDecision(previous, openAIMsg)
      if (dedupeDecision === 'skip-current') {
        continue
      }
      if (dedupeDecision === 'replace-previous') {
        dedupedMessages[dedupedMessages.length - 1] = openAIMsg
        continue
      }
    }

    dedupedMessages.push(openAIMsg)
  }

  for (const openAIMsg of dedupedMessages) {
    if (openAIMsg.role === 'user') {
      if (currentGroup.length > 0) {
        groups.push(currentGroup)
      }
      currentGroup = [openAIMsg]
    } else {
      currentGroup.push(openAIMsg)
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup)
  }

  return groups
}

export function dedupeRelayEchoDecision(
  previous: OpenAI.ChatCompletionMessageParam,
  current: OpenAI.ChatCompletionMessageParam
): 'keep-both' | 'skip-current' | 'replace-previous' {
  const prevRelayLine = parseRelayAgentLine(previous)
  const currentRelayLine = parseRelayAgentLine(current)
  if (!prevRelayLine || !currentRelayLine) return 'keep-both'
  if (prevRelayLine.payloadNormalized !== currentRelayLine.payloadNormalized) return 'keep-both'
  if (prevRelayLine.source === currentRelayLine.source) return 'keep-both'

  // Prefer canonical handle-attributed form when both representations are adjacent.
  if (prevRelayLine.source === 'display' && currentRelayLine.source === 'handle') {
    return 'replace-previous'
  }
  return 'skip-current'
}

function parseRelayAgentLine(msg: OpenAI.ChatCompletionMessageParam): RelayAgentLine | null {
  if (msg.role !== 'user') return null
  if (typeof msg.content !== 'string') return null

  const text = msg.content.trim()
  if (!text) return null

  const handleMatch = text.match(/^\[@[^\]]+\]:\s*(.+)$/s)
  if (handleMatch) {
    const payload = handleMatch[1]?.replace(/\s+/g, ' ').trim().toLowerCase()
    if (payload) {
      return { source: 'handle', payloadNormalized: payload }
    }
    return null
  }

  // Display-name relay messages look like "[🎨 Pixel] 6" or "[🫠 Slopper] ...".
  const displayMatch = text.match(/^\[(?!@)[^\]]+\]\s+(.+)$/s)
  if (displayMatch) {
    const payload = displayMatch[1]?.replace(/\s+/g, ' ').trim().toLowerCase()
    if (payload) {
      return { source: 'display', payloadNormalized: payload }
    }
  }

  return null
}

/**
 * Rewrite a display-name relay message (e.g. "[🫠 Slopper] 5") to the canonical
 * handle format (e.g. "[@nitejar-dev]: 5") used in session history replay.
 * If the text is not a display-relay message or no matching handle is found,
 * returns the original text unchanged.
 */
export function normalizeRelayToHandle(text: string, nameToHandle: Map<string, string>): string {
  // Match display-name relay: "[emoji Name] payload" or "[Name] payload"
  const match = text.match(/^\[(?!@)([^\]]+)\]\s+(.+)$/s)
  if (!match) return text

  const displayName = match[1]!.trim()
  const payload = match[2]!

  // Try matching against known agent names (strip emoji/whitespace for comparison)
  const stripped = displayName.replace(/[\p{Emoji_Presentation}\p{Emoji}\uFE0F\u200D]/gu, '').trim()
  const handle = nameToHandle.get(stripped.toLowerCase())
  if (!handle) return text

  return `[@${handle}]: ${payload}`
}

/**
 * Extract the user message text from a turn group (first message).
 */
function getUserTextFromGroup(group: TurnGroup): string | null {
  const first = group[0]
  if (first && first.role === 'user' && typeof first.content === 'string') {
    return first.content
  }
  return null
}

/**
 * Find the index of the last reset trigger in turn groups.
 */
function findLastResetTriggerIndex(groups: TurnGroup[], triggers: string[]): number {
  for (let i = groups.length - 1; i >= 0; i--) {
    const text = getUserTextFromGroup(groups[i]!)
    if (text && containsResetTrigger(text, triggers)) {
      return i
    }
  }
  return -1
}

/**
 * Estimate total tokens in a turn group.
 */
export function estimateGroupTokens(group: TurnGroup): number {
  let tokens = 0
  for (const msg of group) {
    if ('content' in msg && typeof msg.content === 'string') {
      tokens += estimateTokens(msg.content)
    }
    // Count tool_calls arguments too
    if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if ('function' in tc) {
          tokens += estimateTokens(tc.function.arguments)
        }
      }
    }
  }
  return tokens
}

/** Maximum chars for a single message when compacting session history */
const SESSION_COMPACT_MESSAGE_MAX_CHARS = 800

/**
 * Compact a turn group by truncating oversized individual messages.
 * Tool results and long assistant/user messages are truncated to
 * SESSION_COMPACT_MESSAGE_MAX_CHARS so the group can fit within the
 * token budget instead of being dropped entirely.
 *
 * Returns a shallow copy — original messages are not mutated.
 */
export function compactTurnGroup(group: TurnGroup): TurnGroup {
  return group.map((msg) => {
    if (!('content' in msg) || typeof msg.content !== 'string') return msg
    if (msg.content.length <= SESSION_COMPACT_MESSAGE_MAX_CHARS) return msg

    const maxChars = SESSION_COMPACT_MESSAGE_MAX_CHARS
    const head = Math.floor(maxChars * 0.75)
    const tail = maxChars - head
    const omitted = msg.content.length - head - tail
    const label = msg.role === 'tool' ? 'tool output' : `${msg.role} message`
    const notice = `\n[${label} truncated: omitted ${omitted.toLocaleString()} chars from session history]`
    const compacted = `${msg.content.slice(0, head)}${notice}${tail > 0 ? `\n${msg.content.slice(msg.content.length - tail)}` : ''}`

    return { ...msg, content: compacted }
  })
}

/**
 * Truncate turn groups to fit within token and turn limits.
 *
 * Strategy (newest-first):
 * 1. Slice to maxTurns most recent groups.
 * 2. Walk from newest to oldest, adding groups while under maxTokens.
 * 3. When a group doesn't fit at its original size, compact its
 *    individual messages (truncate large tool results, etc.) and
 *    re-check. This avoids dropping entire conversation turns just
 *    because one tool result was large.
 * 4. If the compacted group still doesn't fit, stop (oldest history
 *    is least valuable).
 */
export function truncateTurnGroups(
  groups: TurnGroup[],
  maxTurns: number,
  maxTokens: number
): { groups: TurnGroup[]; truncated: boolean; totalTokens: number } {
  let result = groups
  let truncated = false

  if (result.length > maxTurns) {
    result = result.slice(result.length - maxTurns)
    truncated = true
  }

  let totalTokens = 0
  const fitting: TurnGroup[] = []

  for (let i = result.length - 1; i >= 0; i--) {
    const group = result[i]
    if (!group) continue

    const groupTokens = estimateGroupTokens(group)

    if (totalTokens + groupTokens <= maxTokens) {
      fitting.unshift(group)
      totalTokens += groupTokens
    } else {
      // Try compacting individual messages before giving up on the group
      const compacted = compactTurnGroup(group)
      const compactedTokens = estimateGroupTokens(compacted)

      if (totalTokens + compactedTokens <= maxTokens) {
        fitting.unshift(compacted)
        totalTokens += compactedTokens
        truncated = true // content was truncated even though group was kept
      } else {
        truncated = true
        break
      }
    }
  }

  return { groups: fitting, truncated, totalTokens }
}

/**
 * Group messages into simple text turns — used only for compaction summaries.
 */
function groupMessagesIntoTextTurns(messages: SessionMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  let currentUserMessage: string | null = null
  let currentTimestamp: number | null = null

  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'tool') continue

    const text = parseMessageText(msg.content)
    if (!text) continue

    if (msg.role === 'user') {
      currentUserMessage = text
      currentTimestamp = msg.created_at
    } else if (msg.role === 'assistant' && currentUserMessage) {
      turns.push({
        userMessage: currentUserMessage,
        assistantResponse: text,
        timestamp: currentTimestamp!,
      })
      currentUserMessage = null
      currentTimestamp = null
    }
  }

  return turns
}

/**
 * Build session context from conversation history
 * If asOfTimestamp is provided, context is reconstructed as-of that moment in time.
 */
export async function buildSessionContext(
  sessionKey: string,
  currentJobId: string,
  agentId: string,
  settings?: SessionSettings,
  asOfTimestamp?: number,
  excludeJobIds?: string[]
): Promise<SessionContext> {
  const effectiveSettings = {
    ...DEFAULT_SESSION_SETTINGS,
    ...settings,
    compaction: {
      ...DEFAULT_COMPACTION_SETTINGS,
      ...settings?.compaction,
    },
  }

  // If sessions are disabled, return empty context
  if (!effectiveSettings.enabled) {
    return {
      turnGroups: [],
      totalTokens: 0,
      truncated: false,
      previousSummary: null,
      wasReset: false,
    }
  }

  // Calculate cutoff for daily reset
  const dailyCutoff = calculateSessionCutoff(effectiveSettings.dailyResetHour, asOfTimestamp)

  // Get all messages from the session (across all agents on this session)
  // Don't filter by agentId — in multi-agent sessions, agents need to see
  // each other's messages. Attribution is handled in toOpenAIMessage.
  // Combine current job + any additional excludes (e.g. sibling jobs for UI display)
  const allExcludeIds = [currentJobId, ...(excludeJobIds ?? [])]

  const messages = await listMessagesBySession(sessionKey, {
    excludeJobIds: allExcludeIds,
    completedOnly: true,
    afterTimestamp: dailyCutoff ?? undefined,
    completedBeforeTimestamp: asOfTimestamp,
  })

  // Group into turn groups — pass currentAgentId so other agents' messages
  // are attributed (prefixed with [@handle]) and their tool calls are skipped
  let turnGroups = groupIntoTurnGroups(messages, agentId)

  // Check for reset triggers and truncate at the last one
  const resetIndex = findLastResetTriggerIndex(turnGroups, effectiveSettings.resetTriggers)
  const wasReset = resetIndex >= 0

  if (wasReset) {
    // Keep only turns after the reset trigger
    turnGroups = turnGroups.slice(resetIndex + 1)
  }

  // Load previous session summary if available and enabled
  let previousSummary: string | null = null
  if (effectiveSettings.compaction.loadPreviousSummary && !wasReset) {
    const summary = await findLatestSessionSummary(sessionKey, agentId, {
      beforeTimestamp: asOfTimestamp,
    })
    if (summary) {
      previousSummary = summary.summary
    }
  }

  // Truncate to fit limits
  const {
    groups: truncatedGroups,
    truncated,
    totalTokens,
  } = truncateTurnGroups(turnGroups, effectiveSettings.maxTurns, effectiveSettings.maxTokens)

  return {
    turnGroups: truncatedGroups,
    totalTokens,
    truncated,
    previousSummary,
    wasReset,
  }
}

/**
 * Format session context as OpenAI messages.
 * Returns the full message chain including assistant tool_calls and tool results,
 * exactly as they appeared during the original inference loop.
 */
export function formatSessionMessages(
  context: SessionContext
): OpenAI.ChatCompletionMessageParam[] {
  const messages: OpenAI.ChatCompletionMessageParam[] = []

  // Add previous session summary if available
  if (context.previousSummary) {
    messages.push({
      role: 'system',
      content: wrapBoundary(
        'context',
        `[Previous conversation summary]\n${context.previousSummary}`,
        { source: 'session-summary' }
      ),
    })
  }

  // Notify the model when earlier conversation history was truncated
  if (context.truncated) {
    messages.push({
      role: 'system',
      content:
        '[Session context] Earlier messages in this conversation were omitted to fit context limits. ' +
        'If you need prior context, check your available tools for ways to look up conversation history.',
    })
  }

  // Flatten turn groups into message sequence
  for (const group of context.turnGroups) {
    messages.push(...group)
  }

  return messages
}

/**
 * Check if a new session should be started (previous one timed out)
 */
export async function shouldStartNewSession(
  sessionKey: string,
  agentId: string,
  idleTimeoutMinutes: number
): Promise<boolean> {
  const lastMessageTime = await getLastSessionMessageTime(sessionKey, agentId)

  // No previous messages = new session
  if (lastMessageTime === null) {
    return true
  }

  return isSessionExpired(lastMessageTime, idleTimeoutMinutes)
}

/**
 * Clear session-related data (memories) on reset if configured
 */
export async function clearSessionMemories(agentId: string, clearMemories: boolean): Promise<void> {
  if (clearMemories) {
    await deleteNonPermanentMemoriesByAgent(agentId)
  }
}

/**
 * Compact a completed session into a summary
 * Should be called when a session times out before starting a new one
 *
 * Also cleans up any associated sprite sessions for this conversation.
 */
export async function compactSession(
  sessionKey: string,
  agentId: string,
  settings: CompactionSettings,
  summarizeFunction?: (messages: SessionMessage[]) => Promise<string>
): Promise<void> {
  const effectiveSettings = {
    ...DEFAULT_COMPACTION_SETTINGS,
    ...settings,
  }

  if (!effectiveSettings.enabled) {
    return
  }

  // Get all messages from the session
  const messages = await listMessagesBySession(sessionKey, {
    completedOnly: true,
    agentId,
  })

  if (messages.length === 0) {
    return
  }

  // Group into text turns for summary generation
  const turns = groupMessagesIntoTextTurns(messages)
  if (turns.length === 0) {
    return
  }

  // Get first and last message timestamps (safe - we checked length > 0 above)
  const startTime = messages[0]!.created_at
  const endTime = messages[messages.length - 1]!.created_at

  // Generate summary
  let summary: string
  if (summarizeFunction) {
    summary = await summarizeFunction(messages)
  } else {
    // Default: simple concatenation of topics (will be replaced with LLM call)
    summary = generateDefaultSummary(turns)
  }

  // Store the summary
  await createSessionSummary({
    session_key: sessionKey,
    agent_id: agentId,
    summary,
    turn_count: turns.length,
    start_time: startTime,
    end_time: endTime,
    embedding: null, // TODO: Generate embedding for search
  })

  // Clean up sprite session for this conversation
  // When compacting, we're done with this conversation's shell state
  await closeSpriteSessionForConversation(sessionKey, agentId)
}

/**
 * Generate a simple default summary from turns
 * Used as fallback when no LLM summarization is available
 */
function generateDefaultSummary(turns: ConversationTurn[]): string {
  const topics: string[] = []

  for (const turn of turns.slice(0, 5)) {
    // Take first 50 chars of each user message as a topic indicator
    const topic = turn.userMessage.slice(0, 50)
    topics.push(topic + (turn.userMessage.length > 50 ? '...' : ''))
  }

  const moreCount = turns.length - 5
  const moreText = moreCount > 0 ? ` (and ${moreCount} more exchanges)` : ''

  return `Conversation topics: ${topics.join('; ')}${moreText}`
}
