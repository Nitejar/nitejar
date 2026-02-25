import type { ChannelThreadMessage } from '@nitejar/database'

/** Maximum total characters for the formatted prelude. */
export const CHANNEL_PRELUDE_MAX_CHARS = 2800
/** Maximum characters per individual message line. */
export const CHANNEL_PRELUDE_PER_MSG_MAX_CHARS = 240
/** Maximum raw messages to fetch from the DB. */
export const CHANNEL_PRELUDE_MAX_MESSAGES = 300

/**
 * A single grouped thread with its messages, used internally for formatting.
 */
interface ThreadGroup {
  sessionKey: string
  /** Earliest jobCreatedAt among the messages in this group */
  earliestJobTime: number
  messages: ChannelThreadMessage[]
}

/**
 * Format a relative time label from a Unix epoch timestamp.
 */
function relativeTimeLabel(epochSeconds: number): string {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const diffSeconds = nowSeconds - epochSeconds
  if (diffSeconds < 60) return 'just now'
  const minutes = Math.floor(diffSeconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/**
 * Truncate a string to a max length, appending ellipsis if truncated.
 */
function truncateMessage(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars - 1) + '\u2026'
}

/**
 * Extract plain text from a message content field (may be JSON).
 */
function extractText(content: string | null): string | null {
  if (!content) return null
  // Try to parse as JSON and extract a text field
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    if (typeof parsed.text === 'string') return parsed.text.trim() || null
    if (typeof parsed.content === 'string') return parsed.content.trim() || null
    // For array content (tool calls, etc.), skip
    if (Array.isArray(parsed)) return null
  } catch {
    // Not JSON — treat as plain text
  }
  const trimmed = content.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Format a single message line with attribution.
 */
function formatMessageLine(msg: ChannelThreadMessage): string | null {
  const text = extractText(msg.content)
  if (!text) return null

  const truncated = truncateMessage(text, CHANNEL_PRELUDE_PER_MSG_MAX_CHARS)
  if (msg.role === 'user') {
    return `User: ${truncated}`
  }
  return `@${msg.agentHandle}: ${truncated}`
}

/**
 * Build a formatted channel prelude string from raw channel thread messages.
 *
 * Groups messages by session key (thread), formats with attribution,
 * adds thread separators with relative time, and packs into a character budget
 * (newest threads first, dropping oldest threads that don't fit).
 *
 * Returns null if there are no formattable messages.
 */
export function buildChannelPrelude(
  messages: ChannelThreadMessage[],
  options?: {
    maxChars?: number
    perMsgMaxChars?: number
    nowSeconds?: number
  }
): string | null {
  if (messages.length === 0) return null

  const maxChars = options?.maxChars ?? CHANNEL_PRELUDE_MAX_CHARS

  // Group messages by sessionKey
  const groupMap = new Map<string, ThreadGroup>()
  for (const msg of messages) {
    let group = groupMap.get(msg.sessionKey)
    if (!group) {
      group = {
        sessionKey: msg.sessionKey,
        earliestJobTime: msg.jobCreatedAt,
        messages: [],
      }
      groupMap.set(msg.sessionKey, group)
    }
    group.messages.push(msg)
    if (msg.jobCreatedAt < group.earliestJobTime) {
      group.earliestJobTime = msg.jobCreatedAt
    }
  }

  const groups = Array.from(groupMap.values())
  // Sort newest threads first (by earliest job time, descending)
  groups.sort((a, b) => b.earliestJobTime - a.earliestJobTime)

  // Format each thread group into a block
  const threadBlocks: { text: string; time: number }[] = []
  for (const group of groups) {
    const lines: string[] = []
    for (const msg of group.messages) {
      const line = formatMessageLine(msg)
      if (line) lines.push(line)
    }
    if (lines.length === 0) continue

    const timeLabel = relativeTimeLabel(group.earliestJobTime)
    const header = `--- thread (${timeLabel}) ---`
    const block = [header, ...lines].join('\n')
    threadBlocks.push({ text: block, time: group.earliestJobTime })
  }

  if (threadBlocks.length === 0) return null

  // Pack newest first into the character budget
  const selected: string[] = []
  let used = 0
  for (const block of threadBlocks) {
    const extra = block.text.length + (selected.length > 0 ? 1 : 0) // +1 for \n separator
    if (used + extra > maxChars) break
    selected.push(block.text)
    used += extra
  }

  if (selected.length === 0) return null

  return selected.join('\n')
}
