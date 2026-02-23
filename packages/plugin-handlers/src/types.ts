import type { NewWorkItem, PluginInstanceRecord } from '@nitejar/database'

export type InboundActorKind = 'human' | 'agent' | 'bot' | 'system'

export interface InboundActorEnvelope {
  /** Actor category for routing/policy decisions */
  kind: InboundActorKind
  /** Plugin-source actor ID (e.g. Telegram from.id, GitHub user id) */
  externalId?: string
  /** Internal agent ID when the source is known to be one of our agents */
  agentId?: string
  /** Handle/username when available */
  handle?: string
  /** Human-readable label */
  displayName?: string
  /** Plugin source label (telegram, github, etc.) */
  source?: string
}

export interface WebhookImmediateResponse {
  /** HTTP status code to return to the webhook caller. Defaults to 200. */
  status?: number
  /** Response payload to return as JSON. */
  body: unknown
}

/**
 * Result of parsing an incoming webhook
 */
export interface WebhookParseResult {
  /** Whether this webhook should create a work item */
  shouldProcess: boolean
  /** The work item to create (if shouldProcess is true) */
  workItem?: Omit<NewWorkItem, 'plugin_instance_id'>
  /** Idempotency key for deduplication */
  idempotencyKey?: string
  /** Context for response handling */
  responseContext?: unknown
  /** If this is a bot command (e.g., /reset), the command name without slash */
  command?: string
  /** Optional protocol-specific response body/status to return immediately. */
  webhookResponse?: WebhookImmediateResponse
}

/**
 * Result of posting a response back to the plugin instance source
 */
export interface PostResponseResult {
  success: boolean
  outcome?: 'sent' | 'failed' | 'unknown'
  retryable?: boolean
  providerRef?: string
  error?: string
}

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  valid: boolean
  errors?: string[]
}

/**
 * Plugin category for catalog grouping
 */
export type PluginCategory = 'messaging' | 'code' | 'productivity'

/** @deprecated Use PluginCategory instead */
export type IntegrationCategory = PluginCategory

/**
 * Controls when the agent's response is delivered to the plugin instance source.
 *
 * - 'streaming': Post each intermediate assistant message as it arrives (chat-like: Telegram, Discord channels)
 * - 'final':     Only post the agent's final response once the run completes (GitHub issues, email, Notion, forums)
 */
export type ResponseMode = 'streaming' | 'final'

/**
 * A field the user fills in during initial plugin setup.
 */
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
 * The frontend reads this to render a dynamic setup form.
 */
export interface SetupConfig {
  fields: SetupField[]
  credentialHelpUrl?: string
  credentialHelpLabel?: string
  usesRedirectFlow?: boolean
  registrationUrl?: string
  supportsTestBeforeSave?: boolean
}

/**
 * Plugin handler interface
 * Each plugin type (telegram, github, etc.) implements this
 */
export interface PluginHandler<TConfig = unknown> {
  /** Plugin type identifier (e.g., 'telegram', 'github') */
  readonly type: string

  /** Human-readable name */
  readonly displayName: string

  /** Brief description for catalog card */
  readonly description: string

  /** Tabler icon name (e.g., 'brand-telegram') */
  readonly icon: string

  /** Category for catalog grouping */
  readonly category: PluginCategory

  /** Fields that contain sensitive data and should be encrypted */
  readonly sensitiveFields: string[]

  /**
   * How responses are delivered: 'streaming' posts intermediate updates as the agent works,
   * 'final' waits and posts a single response when done. Defaults to 'streaming'.
   */
  readonly responseMode?: ResponseMode

  /** Setup configuration for the admin UI setup wizard */
  readonly setupConfig?: SetupConfig

  /**
   * Validate plugin configuration
   */
  validateConfig(config: unknown): ConfigValidationResult

  /**
   * Parse an incoming webhook request
   */
  parseWebhook(request: Request, pluginInstance: PluginInstanceRecord): Promise<WebhookParseResult>

  /**
   * Post a response back to the plugin
   */
  postResponse(
    pluginInstance: PluginInstanceRecord,
    workItemId: string,
    content: string,
    responseContext?: unknown,
    options?: { hitLimit?: boolean; idempotencyKey?: string }
  ): Promise<PostResponseResult>

  /**
   * Test the plugin connection (e.g., validate API keys)
   */
  testConnection?(config: TConfig): Promise<{ ok: boolean; error?: string }>

  /**
   * Acknowledge receipt of a message (e.g., react with emoji)
   * Called when a work item is created, before processing
   */
  acknowledgeReceipt?(
    pluginInstance: PluginInstanceRecord,
    responseContext?: unknown
  ): Promise<void>
}

/** @deprecated Use PluginHandler instead */
export type IntegrationHandler<TConfig = unknown> = PluginHandler<TConfig>

/**
 * Supported plugin types
 */
export type PluginType = 'telegram' | 'github' | 'slack' | 'discord' | 'webhook' | (string & {})

/** @deprecated Use PluginType instead */
export type IntegrationType = PluginType

export type QueueMode = 'collect' | 'followup' | 'steer'

/**
 * Queue configuration for message coalescing / serialization.
 * Stored inside a plugin instance config JSON under the "queue" key.
 */
export interface QueueConfig {
  /** Queue mode: collect (coalesce), followup (one-at-a-time), steer (inject mid-run) */
  mode: QueueMode
  /** How long to wait for more messages before starting a run (ms) */
  debounceMs: number
  /** Maximum messages to queue during a run before dropping */
  maxQueued: number
}

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  mode: 'steer',
  debounceMs: 2000,
  maxQueued: 10,
}
