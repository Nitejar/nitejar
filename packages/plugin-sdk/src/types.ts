// ============================================================================
// Plugin SDK Types — fully self-contained, zero workspace dependencies.
// These are the public types a third-party plugin author needs.
// ============================================================================

// ---------------------------------------------------------------------------
// Lightweight structural types (plugin authors never need the full DB row)
// ---------------------------------------------------------------------------

/**
 * Minimal plugin instance shape passed to handler methods.
 * The runtime's full database row has more fields, but handlers only need these.
 * TypeScript structural typing ensures the full row is assignable here.
 */
export interface PluginInstance {
  id: string
  type: string
  config: string | null
}

/**
 * Data for creating a new work item. Returned from `parseWebhook`.
 */
export interface NewWorkItemData {
  session_key: string
  source: string
  source_ref: string
  title: string
  payload?: string | null
  status?: string
}

// ---------------------------------------------------------------------------
// Inbound actor envelope (optional metadata about message sender)
// ---------------------------------------------------------------------------

export type InboundActorKind = 'human' | 'agent' | 'bot' | 'system'

export interface InboundActorEnvelope {
  kind: InboundActorKind
  externalId?: string
  agentId?: string
  handle?: string
  displayName?: string
  source?: string
}

// ---------------------------------------------------------------------------
// Handler result types
// ---------------------------------------------------------------------------

/**
 * Result of parsing an incoming webhook.
 */
export interface WebhookParseResult {
  /** Whether this webhook should create a work item */
  shouldProcess: boolean
  /** The work item to create (if shouldProcess is true) */
  workItem?: NewWorkItemData
  /** Idempotency key for deduplication */
  idempotencyKey?: string
  /** Context for response handling */
  responseContext?: unknown
  /** If this is a bot command (e.g., /reset), the command name without slash */
  command?: string
}

/**
 * Result of posting a response back to the integration.
 */
export interface PostResponseResult {
  success: boolean
  outcome?: 'sent' | 'failed' | 'unknown'
  retryable?: boolean
  providerRef?: string
  error?: string
}

/**
 * Configuration validation result.
 */
export interface ConfigValidationResult {
  valid: boolean
  errors?: string[]
}

// ---------------------------------------------------------------------------
// Setup / catalog types
// ---------------------------------------------------------------------------

/** Category for catalog grouping. */
export type IntegrationCategory = 'messaging' | 'code' | 'productivity'

/** @deprecated Use `PluginCategory` instead. */
export type PluginCategory = IntegrationCategory

/**
 * Controls when the agent's response is delivered.
 *
 * - `'streaming'`: Post each intermediate assistant message as it arrives (chat-like).
 * - `'final'`:     Only post the agent's final response once the run completes.
 */
export type ResponseMode = 'streaming' | 'final'

/** A field the user fills in during initial plugin setup. */
export interface SetupField {
  key: string
  label: string
  type: 'text' | 'password' | 'select' | 'boolean'
  required?: boolean
  placeholder?: string
  helpText?: string
  options?: { label: string; value: string }[]
}

/**
 * Metadata describing how to set up a plugin type.
 * The admin UI reads this to render a dynamic setup form.
 */
export interface SetupConfig {
  fields: SetupField[]
  credentialHelpUrl?: string
  credentialHelpLabel?: string
  usesRedirectFlow?: boolean
  registrationUrl?: string
  supportsTestBeforeSave?: boolean
}

// ---------------------------------------------------------------------------
// Plugin Handler — the main interface plugin authors implement
// ---------------------------------------------------------------------------

/**
 * Plugin handler interface.
 * Each plugin type (telegram, github, webhook, etc.) implements this.
 */
export interface PluginHandler<TConfig = unknown> {
  /** Plugin type identifier (e.g., 'telegram', 'github', 'webhook') */
  readonly type: string

  /** Human-readable name */
  readonly displayName: string

  /** Brief description for catalog card */
  readonly description: string

  /** Tabler icon name (e.g., 'brand-telegram') */
  readonly icon: string

  /** Category for catalog grouping */
  readonly category: IntegrationCategory

  /** Fields that contain sensitive data and should be encrypted */
  readonly sensitiveFields: string[]

  /**
   * How responses are delivered: 'streaming' posts intermediate updates as the agent works,
   * 'final' waits and posts a single response when done. Defaults to 'streaming'.
   */
  readonly responseMode?: ResponseMode

  /** Setup configuration for the admin UI setup wizard */
  readonly setupConfig?: SetupConfig

  /** Validate plugin configuration */
  validateConfig(config: unknown): ConfigValidationResult

  /** Parse an incoming webhook request */
  parseWebhook(request: Request, pluginInstance: PluginInstance): Promise<WebhookParseResult>

  /** Post a response back to the plugin source */
  postResponse(
    pluginInstance: PluginInstance,
    workItemId: string,
    content: string,
    responseContext?: unknown,
    options?: { hitLimit?: boolean; idempotencyKey?: string }
  ): Promise<PostResponseResult>

  /** Test the plugin connection (e.g., validate API keys) */
  testConnection?(config: TConfig): Promise<{ ok: boolean; error?: string }>

  /** Acknowledge receipt of a message (e.g., react with emoji) */
  acknowledgeReceipt?(pluginInstance: PluginInstance, responseContext?: unknown): Promise<void>
}

/**
 * @deprecated Use `PluginHandler` instead.
 */
export type IntegrationHandler<TConfig = unknown> = PluginHandler<TConfig>

// ---------------------------------------------------------------------------
// Plugin export shape (what definePlugin validates)
// ---------------------------------------------------------------------------

/** Structural type for agent-side provider (avoids @nitejar/agent dependency). */
export interface PluginProvider {
  integrationType: string
  toolDefinitions?: unknown[]
  toolHandlers?: Record<string, unknown>
  getSystemPromptSections?(...args: unknown[]): Promise<unknown[]>
  getPreambleMessage?(...args: unknown[]): unknown
  getPreambleLabel?(...args: unknown[]): string | null
  getDirectoryContextHint?(...args: unknown[]): string | null
}

// ---------------------------------------------------------------------------
// Hook types (lightweight re-declaration for SDK — no runtime dependency)
// ---------------------------------------------------------------------------

/** Hook names that plugins can subscribe to. */
export type HookName =
  | 'work_item.pre_create'
  | 'work_item.post_create'
  | 'run.pre_prompt'
  | 'model.pre_call'
  | 'model.post_call'
  | 'tool.pre_exec'
  | 'tool.post_exec'
  | 'response.pre_deliver'
  | 'response.post_deliver'

/** Context passed to hook handlers. */
export interface HookContext<TData> {
  hookName: HookName
  pluginId: string
  workItemId: string
  jobId: string
  agentId: string
  data: TData
}

/** Result returned by hook handlers. */
export interface HookResult<TData> {
  action: 'continue' | 'block'
  data?: Partial<TData>
}

/** A hook handler function. */
export type HookHandler<TIn = unknown, TOut = TIn> = (
  context: HookContext<TIn>
) => Promise<HookResult<TOut>> | HookResult<TOut>

// ---------------------------------------------------------------------------
// Plugin export shape (what definePlugin validates)
// ---------------------------------------------------------------------------

/** The shape returned by `definePlugin()`. */
export interface PluginExport {
  handler: PluginHandler
  provider?: PluginProvider
  hooks?: Partial<Record<HookName, HookHandler>>
}
