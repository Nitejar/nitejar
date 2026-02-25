/**
 * Agent configuration stored in the agent's config JSON field
 */
export type EditToolMode = 'hashline' | 'replace'
export type TriageReasoningEffort = 'low' | 'medium' | 'high'

export type QueueMode = 'collect' | 'followup' | 'steer'

export interface AgentQueueConfig {
  /** Queue mode: collect (coalesce), followup (one-at-a-time), steer (inject mid-run) */
  mode?: QueueMode
  /** Debounce window in milliseconds */
  debounceMs?: number
  /** Maximum queued messages during a run */
  maxQueued?: number
}

export interface TriageSettings {
  /** Max completion tokens for triage classification */
  maxTokens?: number
  /** Optional reasoning effort hint for models that support it */
  reasoningEffort?: TriageReasoningEffort
  /** Max chars of recent history injected into triage context */
  recentHistoryMaxChars?: number
  /** How many recent messages to scan while assembling triage history */
  recentHistoryLookbackMessages?: number
  /** Per-message truncation cap when building triage history lines */
  recentHistoryPerMessageMaxChars?: number
}

export interface AgentConfig {
  // Legacy system prompt (kept for backwards compatibility)
  systemPrompt?: string

  // Model settings
  model?: string
  temperature?: number
  maxTokens?: number
  editToolMode?: EditToolMode

  // Identity settings
  title?: string
  emoji?: string
  avatarUrl?: string

  // Soul - single freeform document
  soul?: string

  // Memory settings
  memorySettings?: MemorySettings

  // Session settings
  sessionSettings?: SessionSettings

  // Network policy settings
  networkPolicy?: NetworkPolicy

  // Sandbox settings
  allowEphemeralSandboxCreation?: boolean
  // Routine management settings
  allowRoutineManagement?: boolean
  // Dangerous unrestricted mode (platform-management tools + elevated writes)
  dangerouslyUnrestricted?: boolean

  // Queue settings (per-agent override for queue behavior)
  queue?: AgentQueueConfig

  // Triage settings (lightweight classifier pass before full run)
  triageSettings?: TriageSettings
}

/**
 * Network access mode for policy rules.
 */
export type NetworkPolicyMode = 'allow-list' | 'deny-list' | 'unrestricted'

/**
 * A single network policy rule.
 */
export interface NetworkPolicyRule {
  /** Domain pattern to match (example.com, *.example.com, or *) */
  domain: string
  /** Action to apply when the rule matches */
  action: 'allow' | 'deny'
}

/**
 * Full network policy configuration.
 */
export interface NetworkPolicy {
  mode: NetworkPolicyMode
  rules: NetworkPolicyRule[]
  /** Preset ID if this policy came from a preset */
  presetId?: string
  /** True when preset rules were modified */
  customized?: boolean
}

/**
 * A selectable preset for quickly applying common network policies.
 */
export interface PolicyPreset {
  id: string
  name: string
  description: string
  policy: NetworkPolicy
}

/**
 * Settings for session compaction (summarization after session ends)
 */
export interface CompactionSettings {
  /** Whether to automatically compact sessions after idle timeout (default: true) */
  enabled?: boolean
  /** Maximum tokens for the summary (default: 500) */
  summaryMaxTokens?: number
  /**
   * @deprecated Legacy compatibility toggle.
   * Prefer memorySettings.passiveUpdatesEnabled for passive memory extraction behavior.
   */
  extractMemories?: boolean
  /** Whether to inject previous session's summary into new sessions (default: true) */
  loadPreviousSummary?: boolean
}

/**
 * Session management settings for multi-turn conversations
 */
export interface SessionSettings {
  /** Whether session history is enabled (default: true) */
  enabled?: boolean
  /** Maximum conversation turns to include during active session (default: 30) */
  maxTurns?: number
  /** Maximum tokens for session history context (default: 12000) */
  maxTokens?: number
  /** Messages that trigger a session reset (default: ['/clear']) */
  resetTriggers?: string[]
  /** Minutes of inactivity before session is considered ended (default: 120) */
  idleTimeoutMinutes?: number
  /** Hour (0-23) to reset sessions daily, null = disabled (default: null) */
  dailyResetHour?: number | null
  /** Whether to clear non-permanent memories on reset (default: false) */
  clearMemoriesOnReset?: boolean
  /** Settings for session compaction after session ends */
  compaction?: CompactionSettings
  /** Whether to generate embeddings for message search (default: true) */
  messageEmbeddings?: boolean
}

/**
 * Memory system settings
 */
export interface MemorySettings {
  /** Whether memory retrieval is enabled (default: true) */
  enabled?: boolean
  /** Whether passive memory updates from completed runs are enabled (default: false) */
  passiveUpdatesEnabled?: boolean
  /** Maximum memories to inject into context (default: 15) */
  maxMemories?: number
  /** Hard cap for stored memories (default: 200) */
  maxStoredMemories?: number
  /** Strength loss per week of non-access (default: 0.1) */
  decayRate?: number
  /** Strength gain when memory is accessed (default: 0.2) */
  reinforceAmount?: number
  /** How much to weight similarity vs other factors (default: 0.5) */
  similarityWeight?: number
  /** Minimum strength threshold for retrieval (default: 0.1) */
  minStrength?: number
  /** Optional per-agent guidance injected into the passive memory extraction prompt. */
  extractionHint?: string
}

/**
 * Memory with computed similarity score for retrieval
 */
export interface ScoredMemory {
  id: string
  agentId: string
  content: string
  strength: number
  accessCount: number
  permanent: boolean
  version?: number
  lastAccessedAt: number | null
  createdAt: number
  updatedAt: number
  score: number
  similarity?: number
}

/**
 * Work item payload structure (common fields across plugin instance sources)
 */
export interface WorkItemPayload {
  /** The main message body */
  body?: string
  /** Sender's display name */
  senderName?: string
  /** Sender's username (without @) */
  senderUsername?: string
  /** Sender's unique ID */
  senderId?: number | string
  /** Chat/channel name */
  chatName?: string
  /** Chat type (private, group, channel, etc.) */
  chatType?: string
  /** Source plugin/channel type */
  source?: string
  /** Canonical inbound actor envelope used for routing/policy decisions */
  actor?: {
    kind: 'human' | 'agent' | 'bot' | 'system'
    externalId?: string
    agentId?: string
    handle?: string
    displayName?: string
    source?: string
  }
  /** Attachments (images, files, etc.) */
  attachments?: WorkItemAttachment[]
  /** Reply-to message ID for threaded replies */
  replyToMessageId?: number
  /** Reply-to message text for context */
  replyToMessageText?: string
  /** Telegram message thread id (forum topic mode) */
  messageThreadId?: number
  /** Source type for inter-agent messages: 'inter_agent' | 'agent_dm' */
  source_type?: string
  /** Handle of the agent that triggered this message (for inter-agent) */
  triggered_by?: string
  /** Handle of the sender agent (for agent DMs) */
  from_handle?: string
  /** Response context passed through for inter-agent messages */
  responseContext?: unknown
  /** Slack thread timestamp */
  threadTs?: string
  /** Slack message timestamp */
  messageTs?: string
  /** True when inbound Slack message addressed the configured app/bot handle */
  slackBotMentioned?: boolean
  /** Slack bot user ID (U...) for the app mention target */
  slackBotUserId?: string
  /** Resolved Slack bot display name for the app mention target */
  slackBotDisplayName?: string
  /** Resolved Slack bot handle/username for the app mention target */
  slackBotHandle?: string
  /** Allow additional fields */
  [key: string]: unknown
}

export interface WorkItemAttachment {
  type:
    | 'photo'
    | 'document'
    | 'image'
    | 'audio'
    | 'voice'
    | 'video'
    | 'video_note'
    | 'animation'
    | 'sticker'
  fileId?: string
  fileUniqueId?: string
  fileName?: string
  mimeType?: string
  fileUrl?: string
  /** Pre-downloaded image as base64 data URL (used by GitHub attachments) */
  dataUrl?: string
  width?: number
  height?: number
  fileSize?: number
  caption?: string
  duration?: number
  performer?: string
  title?: string
  emoji?: string
  isAnimated?: boolean
  isVideo?: boolean
}
