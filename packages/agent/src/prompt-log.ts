import { appendFileSync, mkdirSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import type OpenAI from 'openai'

export interface PromptLogEntry {
  timestamp: string
  jobId: string
  workItemId: string
  agentId: string
  sessionKey: string
  model: string
  temperature: number
  maxTokens: number | undefined
  messages: OpenAI.ChatCompletionMessageParam[]
  tools?: OpenAI.ChatCompletionTool[]
  sessionTurnsLoaded: number
}

// Use absolute path to project root logs directory
const getLogPath = (): string => {
  if (process.env.PROMPT_LOG_PATH) {
    return process.env.PROMPT_LOG_PATH
  }
  // Find project root by looking for package.json with "nitejar" name
  // Default to cwd-based path as fallback
  const cwd = process.cwd()
  // If running from apps/web, go up to project root
  if (cwd.endsWith('/apps/web')) {
    return join(cwd, '../../logs/prompts.jsonl')
  }
  return join(cwd, 'logs/prompts.jsonl')
}

/**
 * Append a prompt log entry to the log file
 * Only logs if DEBUG_PROMPTS env var is set
 */
export function logPrompt(entry: PromptLogEntry): void {
  if (!process.env.DEBUG_PROMPTS) {
    return
  }

  try {
    const logPath = getLogPath()
    const dir = dirname(logPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const line = JSON.stringify(entry) + '\n'
    appendFileSync(logPath, line)
  } catch (error) {
    console.error('[PromptLog] Failed to write prompt log:', error)
  }
}
