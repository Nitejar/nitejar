import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'

export interface TriageLogEntry {
  timestamp: string
  agentId: string
  agentHandle: string
  workItemId: string
  sessionKey: string
  source: string
  model: string
  rawResponse: string | null
  result: {
    isReadOnly: boolean
    shouldRespond: boolean
    exclusiveClaim?: boolean
    reason: string
    reasonAutoDerived: boolean
    resources: string[]
  }
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    costUsd: number | null
    durationMs: number
  } | null
  error?: string
}

const MAX_RAW_RESPONSE_CHARS = 8000

const getLogPath = (): string => {
  if (process.env.TRIAGE_LOG_PATH) {
    return process.env.TRIAGE_LOG_PATH
  }

  const cwd = process.cwd()
  if (cwd.endsWith('/apps/web')) {
    return join(cwd, '../../logs/triage.jsonl')
  }
  return join(cwd, 'logs/triage.jsonl')
}

function truncateRaw(value: string | null): string | null {
  if (value == null) return null
  if (value.length <= MAX_RAW_RESPONSE_CHARS) return value
  return (
    value.slice(0, MAX_RAW_RESPONSE_CHARS) +
    `\n[triage raw response truncated: omitted ${value.length - MAX_RAW_RESPONSE_CHARS} chars]`
  )
}

/**
 * Append triage decision receipts to logs/triage.jsonl.
 * Logging is enabled when DEBUG_TRIAGE or DEBUG_PROMPTS is set.
 */
export function logTriage(entry: TriageLogEntry): void {
  if (!process.env.DEBUG_TRIAGE && !process.env.DEBUG_PROMPTS) {
    return
  }

  try {
    const logPath = getLogPath()
    const dir = dirname(logPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const safeEntry: TriageLogEntry = {
      ...entry,
      rawResponse: truncateRaw(entry.rawResponse),
    }
    appendFileSync(logPath, JSON.stringify(safeEntry) + '\n')
  } catch (error) {
    console.error('[TriageLog] Failed to write triage log:', error)
  }
}
