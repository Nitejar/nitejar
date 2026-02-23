import type OpenAI from 'openai'

const DEFAULT_MAX_TOOL_RESULT_CHARS = 60_000
const DEFAULT_MAX_MODEL_INPUT_CHARS = 6_500_000
export const MIN_MESSAGE_PRESERVE_CHARS = 256

export function parsePositiveIntEnv(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const MAX_TOOL_RESULT_CHARS = parsePositiveIntEnv(
  'AGENT_TOOL_RESULT_MAX_CHARS',
  DEFAULT_MAX_TOOL_RESULT_CHARS
)
export const MAX_MODEL_INPUT_CHARS = parsePositiveIntEnv(
  'AGENT_MODEL_INPUT_MAX_CHARS',
  DEFAULT_MAX_MODEL_INPUT_CHARS
)

export function extractContentText(content: OpenAI.ChatCompletionMessageParam['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const textPart = part as { text?: unknown }
      return typeof textPart.text === 'string' ? textPart.text : ''
    })
    .join('')
}

export function getMessageContentLength(message: OpenAI.ChatCompletionMessageParam): number {
  return extractContentText(message.content).length
}

export function truncateWithNotice(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text

  const reserved = Math.min(240, Math.floor(maxChars * 0.35))
  const keep = Math.max(0, maxChars - reserved)
  const head = Math.max(0, Math.floor(keep * 0.75))
  const tail = Math.max(0, keep - head)
  const omitted = text.length - head - tail
  const notice = `\n\n[${label} truncated: omitted ${omitted.toLocaleString()} chars]`

  return `${text.slice(0, head)}${notice}${tail > 0 ? `\n${text.slice(text.length - tail)}` : ''}`
}

export function buildToolResultContent(result: {
  success: boolean
  output?: string
  error?: string
}): string {
  return result.success
    ? result.output || 'Success'
    : result.output
      ? `${result.output}\n\nError: ${result.error}`
      : `Error: ${result.error}`
}

export function setStringContent(
  message: OpenAI.ChatCompletionMessageParam,
  content: string
): void {
  ;(message as OpenAI.ChatCompletionMessageParam & { content: string }).content = content
}

export function stripImageInputs(
  messages: OpenAI.ChatCompletionMessageParam[]
): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role !== 'user') return message
    if (!Array.isArray(message.content)) return message
    return {
      ...message,
      content: extractContentText(message.content),
    }
  })
}

export function prepareMessagesForModel(messages: OpenAI.ChatCompletionMessageParam[]): {
  messages: OpenAI.ChatCompletionMessageParam[]
  initialChars: number
  finalChars: number
  compactedToolMessages: number
  compactedNonToolMessages: number
} {
  const prepared = messages.map((message) => ({ ...message }))
  const contentLengths = prepared.map((message) => getMessageContentLength(message))
  const initialChars = contentLengths.reduce((sum, len) => sum + len, 0)
  let totalChars = initialChars
  let compactedToolMessages = 0
  let compactedNonToolMessages = 0

  if (totalChars <= MAX_MODEL_INPUT_CHARS) {
    return {
      messages: prepared,
      initialChars,
      finalChars: totalChars,
      compactedToolMessages,
      compactedNonToolMessages,
    }
  }

  for (let index = 0; index < prepared.length && totalChars > MAX_MODEL_INPUT_CHARS; index++) {
    const message = prepared[index]
    if (!message) continue
    if (message.role !== 'tool') continue
    const length = contentLengths[index] ?? 0
    if (length === 0) continue

    const compacted = `[Tool output omitted (${length.toLocaleString()} chars) to fit model input limits.]`
    const nextLength = compacted.length
    if (nextLength >= length) continue

    setStringContent(message, compacted)
    contentLengths[index] = nextLength
    totalChars -= length - nextLength
    compactedToolMessages++
  }

  for (let index = 1; index < prepared.length - 1 && totalChars > MAX_MODEL_INPUT_CHARS; index++) {
    const message = prepared[index]
    if (!message) continue
    if (message.role === 'tool') continue
    const length = contentLengths[index] ?? 0
    if (length <= MIN_MESSAGE_PRESERVE_CHARS) continue

    const compacted = `[${message.role} message omitted to fit model input limits.]`
    const nextLength = compacted.length
    if (nextLength >= length) continue

    setStringContent(message, compacted)
    contentLengths[index] = nextLength
    totalChars -= length - nextLength
    compactedNonToolMessages++
  }

  return {
    messages: prepared,
    initialChars,
    finalChars: totalChars,
    compactedToolMessages,
    compactedNonToolMessages,
  }
}
