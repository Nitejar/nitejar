import OpenAI from 'openai'
import { getDb, decrypt } from '@nitejar/database'
import { getToolDefinitions } from './tools'
import type { EditToolMode } from './types'

const DEFAULT_GATEWAY_ID = 'default'
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export async function loadGatewayConfig(): Promise<{
  apiKey: string | null
  baseUrl: string | null
  hasSettings: boolean
}> {
  try {
    const db = getDb()
    const settings = await db
      .selectFrom('gateway_settings')
      .selectAll()
      .where('id', '=', DEFAULT_GATEWAY_ID)
      .executeTakeFirst()

    if (!settings) {
      return { apiKey: null, baseUrl: null, hasSettings: false }
    }

    let apiKeyValue: string | null = null
    if (settings.api_key_encrypted) {
      try {
        apiKeyValue = decrypt(settings.api_key_encrypted)
      } catch (error) {
        console.warn('[Gateway] Failed to decrypt gateway API key', error)
      }
    }

    return {
      apiKey: apiKeyValue,
      baseUrl: settings.base_url ?? null,
      hasSettings: true,
    }
  } catch (error) {
    console.warn('[Gateway] Failed to load gateway settings, using env', error)
    return { apiKey: null, baseUrl: null, hasSettings: false }
  }
}

// Initialize OpenRouter client (OpenAI-compatible)
export async function getClient(): Promise<OpenAI> {
  const gateway = await loadGatewayConfig()
  const envOpenRouterKey = process.env.OPENROUTER_API_KEY
  const envOpenAIKey = process.env.OPENAI_API_KEY

  const apiKey = gateway.apiKey || envOpenRouterKey || envOpenAIKey
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY or OPENAI_API_KEY is required')
  }

  const usingOpenRouterKey = Boolean(gateway.apiKey || envOpenRouterKey)
  const baseURL = usingOpenRouterKey ? (gateway.baseUrl ?? DEFAULT_OPENROUTER_BASE_URL) : undefined

  return new OpenAI({ apiKey, baseURL })
}

/**
 * Returns true for transient provider errors worth retrying
 * (rate limits, gateway errors, upstream 5xx, spurious 400s from OpenRouter).
 */
export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { status } = error
    // 429 = rate limit, 500/502/503/504 = server errors
    if (status === 429 || (status !== undefined && status >= 500)) return true
    // OpenRouter sometimes returns 400 for transient upstream issues
    if (status === 400) {
      const msg = (error.message ?? '').toLowerCase()
      // Don't retry genuine validation errors
      if (
        msg.includes('invalid') ||
        msg.includes('malformed') ||
        msg.includes('missing required')
      ) {
        return false
      }
      return true
    }
  }
  // Network-level errors (ECONNRESET, timeouts, etc.)
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('econnrefused') ||
      msg.includes('socket hang up') ||
      msg.includes('fetch failed')
    ) {
      return true
    }
  }
  return false
}

/**
 * Call a model API function with retry + exponential backoff for transient errors.
 */
export async function withProviderRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxRetries?: number; baseDelayMs?: number; label?: string }
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 2
  const baseDelayMs = opts?.baseDelayMs ?? 1000
  const label = opts?.label ?? 'API call'

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < maxRetries && isRetryableProviderError(error)) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const status = error instanceof OpenAI.APIError ? error.status : 'network'
        console.warn(
          `[model-client] ${label} failed (${status}), retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})...`
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }
      throw error
    }
  }
  throw lastError
}

export { openRouterTrace, type OpenRouterTrace } from './openrouter-trace'

export function isLikelyImageInputUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  return (
    (lower.includes('image') && lower.includes('support')) ||
    lower.includes('multimodal') ||
    lower.includes('invalid content type') ||
    lower.includes('content parts')
  )
}

export function isLikelyToolUseUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  return (
    lower.includes('support tool use') ||
    lower.includes('tools unavailable') ||
    lower.includes('tool use is not supported') ||
    lower.includes('function calling is not supported') ||
    lower.includes('no endpoints found that support tool use')
  )
}

/** Tool names that require Tavily to be configured. */
const TAVILY_TOOLS = new Set(['web_search', 'extract_url'])
const ROUTINE_WRITE_TOOLS = new Set([
  'create_routine',
  'update_routine',
  'pause_routine',
  'delete_routine',
  'run_routine_now',
])
const DANGEROUS_PLATFORM_TOOLS = new Set([
  'list_agents',
  'get_agent_config',
  'get_agent_soul',
  'create_agent',
  'set_agent_status',
  'delete_agent',
  'update_agent_config',
  'update_agent_soul',
])

/**
 * Convert our tool definitions to OpenAI format.
 * When `excludeWebTools` is true, web_search and extract_url are omitted
 * (used when Tavily is not configured to avoid confusing the model).
 */
export function getOpenAITools(opts?: {
  excludeWebTools?: boolean
  editToolMode?: EditToolMode
  allowEphemeralSandboxCreation?: boolean
  allowRoutineManagement?: boolean
  dangerouslyUnrestricted?: boolean
}): OpenAI.ChatCompletionTool[] {
  let defs = getToolDefinitions({ editToolMode: opts?.editToolMode })
  if (opts?.excludeWebTools) {
    defs = defs.filter((t) => !TAVILY_TOOLS.has(t.name))
  }
  if (opts?.dangerouslyUnrestricted !== true) {
    defs = defs.filter((t) => !DANGEROUS_PLATFORM_TOOLS.has(t.name))
  }
  if (opts?.dangerouslyUnrestricted !== true && opts?.allowEphemeralSandboxCreation === false) {
    defs = defs.filter((t) => t.name !== 'create_ephemeral_sandbox')
  }
  if (opts?.dangerouslyUnrestricted !== true && opts?.allowRoutineManagement !== true) {
    defs = defs.filter((t) => !ROUTINE_WRITE_TOOLS.has(t.name))
  }
  return defs.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))
}
