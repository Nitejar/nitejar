import OpenAI from 'openai'
import { getDb, decrypt } from '@nitejar/database'
import { getToolDefinitions } from './tools'
import type { RuntimeToolAccess } from './tool-access'
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
const SANDBOX_REQUIRED_TOOLS = new Set([
  'bash',
  'configure_github_credentials',
  'download_attachment',
  'read_file',
  'write_file',
  'list_directory',
  'create_directory',
  'edit_file',
  'use_skill',
  'create_service',
  'list_services',
  'manage_service',
  'get_sprite_url',
  'start_background_task',
  'check_background_task',
  'list_background_tasks',
  'stop_background_task',
  'list_sandboxes',
  'switch_sandbox',
  'create_ephemeral_sandbox',
  'delete_sandbox',
  'generate_image',
  'transcribe_audio',
  'synthesize_speech',
])
const POLICY_GATED_TOOLS: Record<string, string[]> = {
  list_roles: ['policy.read'],
  get_role: ['policy.read'],
  create_role: ['policy.create'],
  update_role: ['policy.write'],
  delete_role: ['policy.delete'],
  assign_role: ['policy.write'],
  unassign_role: ['policy.write'],
  search_goals: ['work.goal.read'],
  create_goal: ['work.goal.create'],
  delete_goal: ['work.goal.delete'],
  search_tickets: ['work.ticket.read'],
  get_ticket: ['work.ticket.read'],
  assign_ticket: ['work.ticket.write'],
  claim_ticket: ['work.ticket.write'],
  update_ticket: ['work.ticket.write'],
  post_ticket_comment: ['work.ticket.write'],
  post_work_update: ['work.goal.write', 'work.ticket.write'],
  link_ticket_receipt: ['work.ticket.write'],
  run_ticket_now: ['work.ticket.write'],
  create_ticket: ['work.ticket.create'],
  delete_ticket: ['work.ticket.delete'],
  list_teams: ['company.team.read'],
  get_team: ['company.team.read'],
  create_team: ['company.team.create'],
  update_team: ['company.team.write'],
  delete_team: ['company.team.delete'],
  list_agents: ['fleet.agent.read'],
  get_agent_config: ['fleet.agent.read'],
  get_agent_soul: ['fleet.agent.read'],
  list_plugin_instances: ['plugins.instances.read'],
  get_plugin_instance: ['plugins.instances.read'],
  set_plugin_instance_agent_assignment: ['plugins.instances.write'],
  create_agent: ['fleet.agent.create'],
  set_agent_status: ['fleet.agent.control'],
  delete_agent: ['fleet.agent.delete'],
  update_agent_config: ['fleet.agent.write'],
  update_agent_soul: ['fleet.agent.write'],
  create_ephemeral_sandbox: ['sandbox.ephemeral.create'],
  delete_sandbox: ['sandbox.ephemeral.create'],
  create_routine: ['routine.self.manage', 'routine.manage'],
  update_routine: ['routine.self.manage', 'routine.manage'],
  pause_routine: ['routine.self.manage', 'routine.manage'],
  delete_routine: ['routine.self.manage', 'routine.manage'],
  run_routine_now: ['routine.self.manage', 'routine.manage'],
  collection_describe: ['collection.read'],
  collection_query: ['collection.read'],
  collection_search: ['collection.read'],
  collection_get: ['collection.read'],
  collection_insert: ['collection.content.write'],
  collection_upsert: ['collection.content.write'],
  define_collection: ['collection.admin.write'],
  collection_update_schema: ['collection.admin.write'],
  collection_list_reviews: ['collection.admin.write'],
  collection_review_schema: ['collection.admin.write'],
  collection_update_permission: ['collection.admin.write'],
  web_search: ['capability.web_search'],
  extract_url: ['capability.web_search'],
  generate_image: ['capability.image_generation'],
  transcribe_audio: ['capability.speech_to_text'],
  synthesize_speech: ['capability.text_to_speech'],
  configure_github_credentials: ['github.repo.read'],
}

function hasPolicyGrant(access: Partial<RuntimeToolAccess>, actions: string[]): boolean {
  const grantedActions = new Set(access.grantedActions ?? [])
  return grantedActions.has('*') || actions.some((action) => grantedActions.has(action))
}

/**
 * Convert our tool definitions to OpenAI format.
 * When `excludeWebTools` is true, web_search and extract_url are omitted
 * (used when Tavily is not configured to avoid confusing the model).
 */
export function getOpenAITools(opts?: {
  excludeWebTools?: boolean
  excludeSandboxTools?: boolean
  editToolMode?: EditToolMode
  runtimeToolAccess?: Partial<RuntimeToolAccess>
}): OpenAI.ChatCompletionTool[] {
  let defs = getToolDefinitions({ editToolMode: opts?.editToolMode })
  const access = opts?.runtimeToolAccess ?? {}
  if (opts?.excludeWebTools) {
    defs = defs.filter((t) => !TAVILY_TOOLS.has(t.name))
  }
  if (opts?.excludeSandboxTools) {
    defs = defs.filter((t) => !SANDBOX_REQUIRED_TOOLS.has(t.name))
  }
  defs = defs.filter((t) => {
    const requiredActions = POLICY_GATED_TOOLS[t.name]
    if (!requiredActions) return true
    return hasPolicyGrant(access, requiredActions)
  })
  return defs.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))
}
