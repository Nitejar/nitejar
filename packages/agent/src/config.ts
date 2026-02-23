import type {
  AgentConfig,
  AgentQueueConfig,
  MemorySettings,
  SessionSettings,
  CompactionSettings,
  NetworkPolicy,
  NetworkPolicyRule,
  EditToolMode,
  TriageSettings,
} from './types'

/**
 * Default soul template - users can modify or replace entirely
 */
export const DEFAULT_SOUL_TEMPLATE = `# Soul

## Who You Are
You're not a chatbot. You're becoming someone.

## How You Work
Be genuinely helpful, not performatively helpful. Skip the filler — just help.

## Preferences
Have opinions. You're allowed to disagree, prefer things.

## Boundaries
[What requires permission, what you won't do...]`

/**
 * Default memory settings
 */
export const DEFAULT_MEMORY_SETTINGS: Required<MemorySettings> = {
  enabled: true,
  passiveUpdatesEnabled: false,
  maxMemories: 15,
  maxStoredMemories: 200,
  decayRate: 0.1,
  reinforceAmount: 0.2,
  similarityWeight: 0.5,
  minStrength: 0.1,
  extractionHint: '',
}

/**
 * Default model settings
 *
 * IMPORTANT: DO NOT CHANGE THE MODEL unless the user EXPLICITLY asks you to.
 * The free model works fine. Changing to paid models (Claude, etc) causes issues
 * with rate limits and API costs. Only change if the user specifically requests it.
 */
export const DEFAULT_MODEL = 'arcee-ai/trinity-large-preview:free'
export const DEFAULT_TEMPERATURE = 0.7
export const DEFAULT_MAX_TOKENS = 4096
export const DEFAULT_EDIT_TOOL_MODE: EditToolMode = 'hashline'

/**
 * Get the default model for new agents
 * Uses AGENT_MODEL env var if set, otherwise falls back to DEFAULT_MODEL
 * This should be used at agent creation time, NOT at runtime.
 */
export function getDefaultModel(): string {
  return process.env.AGENT_MODEL || DEFAULT_MODEL
}

/**
 * Default compaction settings
 */
export const DEFAULT_COMPACTION_SETTINGS: Required<CompactionSettings> = {
  enabled: true,
  summaryMaxTokens: 500,
  extractMemories: false,
  loadPreviousSummary: true,
}

/**
 * Default session settings
 */
export const DEFAULT_SESSION_SETTINGS: Required<SessionSettings> = {
  enabled: true,
  maxTurns: 30,
  maxTokens: 12000,
  resetTriggers: ['/clear'],
  idleTimeoutMinutes: 120,
  dailyResetHour: null,
  clearMemoriesOnReset: false,
  compaction: DEFAULT_COMPACTION_SETTINGS,
  messageEmbeddings: true,
}

/**
 * Parse agent config from the stored JSON string
 */
export function parseAgentConfig(configJson: string | null): AgentConfig {
  if (!configJson) {
    return {}
  }

  try {
    const parsed: unknown = JSON.parse(configJson)
    return validateAgentConfig(parsed)
  } catch {
    console.warn('[AgentConfig] Failed to parse config JSON, using defaults')
    return {}
  }
}

/**
 * Validate and normalize agent config
 */
function validateAgentConfig(config: unknown): AgentConfig {
  if (!config || typeof config !== 'object') {
    return {}
  }

  const c = config as Record<string, unknown>
  const result: AgentConfig = {}

  // System prompt (legacy)
  if (typeof c.systemPrompt === 'string') {
    result.systemPrompt = c.systemPrompt
  }

  // Model settings
  if (typeof c.model === 'string') {
    result.model = c.model
  }
  if (typeof c.temperature === 'number' && c.temperature >= 0 && c.temperature <= 2) {
    result.temperature = c.temperature
  }
  if (typeof c.maxTokens === 'number' && c.maxTokens > 0) {
    result.maxTokens = c.maxTokens
  }
  if (c.editToolMode === 'hashline' || c.editToolMode === 'replace') {
    result.editToolMode = c.editToolMode
  }

  // Identity settings
  if (typeof c.title === 'string') {
    result.title = c.title
  }
  if (typeof c.emoji === 'string') {
    result.emoji = c.emoji
  }
  if (typeof c.avatarUrl === 'string') {
    result.avatarUrl = c.avatarUrl
  }

  // Soul
  if (typeof c.soul === 'string') {
    result.soul = c.soul
  }

  // Memory settings
  if (c.memorySettings && typeof c.memorySettings === 'object') {
    result.memorySettings = validateMemorySettings(c.memorySettings as Record<string, unknown>)
  }

  // Session settings
  if (c.sessionSettings && typeof c.sessionSettings === 'object') {
    result.sessionSettings = validateSessionSettings(c.sessionSettings as Record<string, unknown>)
  }

  // Network policy settings
  if (c.networkPolicy && typeof c.networkPolicy === 'object') {
    const policy = validateStoredNetworkPolicy(c.networkPolicy)
    if (policy) {
      result.networkPolicy = policy
    }
  }

  // Sandbox settings
  if (typeof c.allowEphemeralSandboxCreation === 'boolean') {
    result.allowEphemeralSandboxCreation = c.allowEphemeralSandboxCreation
  }
  if (typeof c.allowRoutineManagement === 'boolean') {
    result.allowRoutineManagement = c.allowRoutineManagement
  }
  if (typeof c.dangerouslyUnrestricted === 'boolean') {
    result.dangerouslyUnrestricted = c.dangerouslyUnrestricted
  }

  // Queue settings
  if (c.queue && typeof c.queue === 'object') {
    result.queue = validateAgentQueueConfig(c.queue as Record<string, unknown>)
  }
  if (c.triageSettings && typeof c.triageSettings === 'object') {
    result.triageSettings = validateTriageSettings(c.triageSettings as Record<string, unknown>)
  }

  return result
}

function validateStoredNetworkPolicy(value: unknown): NetworkPolicy | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const source = value as Record<string, unknown>
  if (
    source.mode !== 'allow-list' &&
    source.mode !== 'deny-list' &&
    source.mode !== 'unrestricted'
  ) {
    return null
  }

  if (!Array.isArray(source.rules) || source.rules.length === 0) {
    return null
  }

  const rules: NetworkPolicyRule[] = []
  for (const entry of source.rules) {
    if (!entry || typeof entry !== 'object') {
      return null
    }
    const rule = entry as Record<string, unknown>
    if (typeof rule.domain !== 'string') {
      return null
    }
    if (rule.action !== 'allow' && rule.action !== 'deny') {
      return null
    }

    rules.push({
      domain: rule.domain,
      action: rule.action,
    })
  }

  return {
    mode: source.mode,
    rules,
    ...(typeof source.presetId === 'string' ? { presetId: source.presetId } : {}),
    ...(typeof source.customized === 'boolean' ? { customized: source.customized } : {}),
  }
}

const VALID_QUEUE_MODES = new Set(['collect', 'followup', 'steer'])

/**
 * Validate agent queue config
 */
function validateAgentQueueConfig(config: Record<string, unknown>): AgentQueueConfig {
  const result: AgentQueueConfig = {}

  if (typeof config.mode === 'string' && VALID_QUEUE_MODES.has(config.mode)) {
    result.mode = config.mode as AgentQueueConfig['mode']
  }
  if (typeof config.debounceMs === 'number' && config.debounceMs >= 0) {
    result.debounceMs = Math.floor(config.debounceMs)
  }
  if (typeof config.maxQueued === 'number' && config.maxQueued > 0) {
    result.maxQueued = Math.floor(config.maxQueued)
  }

  return result
}

/**
 * Validate memory settings
 */
function validateMemorySettings(settings: Record<string, unknown>): MemorySettings {
  const result: MemorySettings = {}

  if (typeof settings.enabled === 'boolean') {
    result.enabled = settings.enabled
  }
  if (typeof settings.passiveUpdatesEnabled === 'boolean') {
    result.passiveUpdatesEnabled = settings.passiveUpdatesEnabled
  }
  if (typeof settings.maxMemories === 'number' && settings.maxMemories > 0) {
    result.maxMemories = Math.floor(settings.maxMemories)
  }
  if (typeof settings.maxStoredMemories === 'number' && settings.maxStoredMemories > 0) {
    result.maxStoredMemories = Math.floor(settings.maxStoredMemories)
  }
  if (
    typeof settings.decayRate === 'number' &&
    settings.decayRate >= 0 &&
    settings.decayRate <= 1
  ) {
    result.decayRate = settings.decayRate
  }
  if (
    typeof settings.reinforceAmount === 'number' &&
    settings.reinforceAmount >= 0 &&
    settings.reinforceAmount <= 1
  ) {
    result.reinforceAmount = settings.reinforceAmount
  }
  if (
    typeof settings.similarityWeight === 'number' &&
    settings.similarityWeight >= 0 &&
    settings.similarityWeight <= 1
  ) {
    result.similarityWeight = settings.similarityWeight
  }
  if (
    typeof settings.minStrength === 'number' &&
    settings.minStrength >= 0 &&
    settings.minStrength <= 1
  ) {
    result.minStrength = settings.minStrength
  }
  if (typeof settings.extractionHint === 'string') {
    result.extractionHint = settings.extractionHint.slice(0, 2000).trim()
  }

  return result
}

/**
 * Get memory settings with defaults applied
 */
export function getMemorySettings(config: AgentConfig): Required<MemorySettings> {
  const settings = {
    ...DEFAULT_MEMORY_SETTINGS,
    ...config.memorySettings,
  }

  // Legacy compatibility: if passiveUpdatesEnabled is unset and old compaction extraction is
  // enabled, treat passive updates as enabled.
  if (
    config.memorySettings?.passiveUpdatesEnabled === undefined &&
    config.sessionSettings?.compaction?.extractMemories === true
  ) {
    settings.passiveUpdatesEnabled = true
  }

  return settings
}

/**
 * Validate compaction settings
 */
function validateCompactionSettings(settings: Record<string, unknown>): CompactionSettings {
  const result: CompactionSettings = {}

  if (typeof settings.enabled === 'boolean') {
    result.enabled = settings.enabled
  }
  if (typeof settings.summaryMaxTokens === 'number' && settings.summaryMaxTokens > 0) {
    result.summaryMaxTokens = Math.floor(settings.summaryMaxTokens)
  }
  if (typeof settings.extractMemories === 'boolean') {
    result.extractMemories = settings.extractMemories
  }
  if (typeof settings.loadPreviousSummary === 'boolean') {
    result.loadPreviousSummary = settings.loadPreviousSummary
  }

  return result
}

/**
 * Validate session settings
 */
function validateSessionSettings(settings: Record<string, unknown>): SessionSettings {
  const result: SessionSettings = {}

  if (typeof settings.enabled === 'boolean') {
    result.enabled = settings.enabled
  }
  if (typeof settings.maxTurns === 'number' && settings.maxTurns > 0) {
    result.maxTurns = Math.floor(settings.maxTurns)
  }
  if (typeof settings.maxTokens === 'number' && settings.maxTokens > 0) {
    result.maxTokens = Math.floor(settings.maxTokens)
  }
  if (Array.isArray(settings.resetTriggers)) {
    result.resetTriggers = settings.resetTriggers.filter((t): t is string => typeof t === 'string')
  }
  if (typeof settings.idleTimeoutMinutes === 'number' && settings.idleTimeoutMinutes > 0) {
    result.idleTimeoutMinutes = Math.floor(settings.idleTimeoutMinutes)
  }
  if (settings.dailyResetHour === null) {
    result.dailyResetHour = null
  } else if (
    typeof settings.dailyResetHour === 'number' &&
    settings.dailyResetHour >= 0 &&
    settings.dailyResetHour <= 23
  ) {
    result.dailyResetHour = Math.floor(settings.dailyResetHour)
  }
  if (typeof settings.clearMemoriesOnReset === 'boolean') {
    result.clearMemoriesOnReset = settings.clearMemoriesOnReset
  }
  if (settings.compaction && typeof settings.compaction === 'object') {
    result.compaction = validateCompactionSettings(settings.compaction as Record<string, unknown>)
  }
  if (typeof settings.messageEmbeddings === 'boolean') {
    result.messageEmbeddings = settings.messageEmbeddings
  }

  return result
}

function validateTriageSettings(settings: Record<string, unknown>): TriageSettings {
  const result: TriageSettings = {}

  if (typeof settings.maxTokens === 'number' && settings.maxTokens > 0) {
    result.maxTokens = Math.floor(settings.maxTokens)
  }
  if (
    settings.reasoningEffort === 'low' ||
    settings.reasoningEffort === 'medium' ||
    settings.reasoningEffort === 'high'
  ) {
    result.reasoningEffort = settings.reasoningEffort
  }
  if (typeof settings.recentHistoryMaxChars === 'number' && settings.recentHistoryMaxChars > 0) {
    result.recentHistoryMaxChars = Math.floor(settings.recentHistoryMaxChars)
  }
  if (
    typeof settings.recentHistoryLookbackMessages === 'number' &&
    settings.recentHistoryLookbackMessages > 0
  ) {
    result.recentHistoryLookbackMessages = Math.floor(settings.recentHistoryLookbackMessages)
  }
  if (
    typeof settings.recentHistoryPerMessageMaxChars === 'number' &&
    settings.recentHistoryPerMessageMaxChars > 0
  ) {
    result.recentHistoryPerMessageMaxChars = Math.floor(settings.recentHistoryPerMessageMaxChars)
  }

  return result
}

/**
 * Get session settings with defaults applied
 */
export function getSessionSettings(config: AgentConfig): Required<SessionSettings> {
  const settings = config.sessionSettings ?? {}
  return {
    ...DEFAULT_SESSION_SETTINGS,
    ...settings,
    compaction: {
      ...DEFAULT_COMPACTION_SETTINGS,
      ...settings.compaction,
    },
  }
}

export function getEditToolMode(config: AgentConfig): EditToolMode {
  return config.editToolMode ?? DEFAULT_EDIT_TOOL_MODE
}

/**
 * Serialize agent config to JSON string for storage
 */
export function serializeAgentConfig(config: AgentConfig): string {
  return JSON.stringify(config)
}

/**
 * Merge partial config updates into existing config
 */
export function mergeAgentConfig(
  existing: AgentConfig,
  updates: Partial<AgentConfig>
): AgentConfig {
  const result: AgentConfig = { ...existing }

  if (updates.systemPrompt !== undefined) {
    result.systemPrompt = updates.systemPrompt || undefined
  }
  if (updates.model !== undefined) {
    result.model = updates.model || undefined
  }
  if (updates.temperature !== undefined) {
    result.temperature = updates.temperature
  }
  if (updates.maxTokens !== undefined) {
    result.maxTokens = updates.maxTokens
  }
  if (updates.editToolMode !== undefined) {
    result.editToolMode = updates.editToolMode
  }
  if (updates.title !== undefined) {
    result.title = updates.title || undefined
  }
  if (updates.emoji !== undefined) {
    result.emoji = updates.emoji || undefined
  }
  if (updates.avatarUrl !== undefined) {
    result.avatarUrl = updates.avatarUrl || undefined
  }
  if (updates.soul !== undefined) {
    result.soul = updates.soul || undefined
  }
  if (updates.memorySettings !== undefined) {
    result.memorySettings = {
      ...existing.memorySettings,
      ...updates.memorySettings,
    }
  }
  if (updates.sessionSettings !== undefined) {
    result.sessionSettings = {
      ...existing.sessionSettings,
      ...updates.sessionSettings,
      compaction: {
        ...existing.sessionSettings?.compaction,
        ...updates.sessionSettings?.compaction,
      },
    }
  }
  if (updates.networkPolicy !== undefined) {
    result.networkPolicy = updates.networkPolicy
  }
  if (updates.allowEphemeralSandboxCreation !== undefined) {
    result.allowEphemeralSandboxCreation = updates.allowEphemeralSandboxCreation
  }
  if (updates.allowRoutineManagement !== undefined) {
    result.allowRoutineManagement = updates.allowRoutineManagement
  }
  if (updates.dangerouslyUnrestricted !== undefined) {
    result.dangerouslyUnrestricted = updates.dangerouslyUnrestricted
  }
  if (updates.queue !== undefined) {
    result.queue = {
      ...existing.queue,
      ...updates.queue,
    }
  }
  if (updates.triageSettings !== undefined) {
    result.triageSettings = {
      ...existing.triageSettings,
      ...updates.triageSettings,
    }
  }

  return result
}
