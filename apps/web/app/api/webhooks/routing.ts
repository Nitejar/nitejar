import {
  DEFAULT_QUEUE_CONFIG,
  type InboundActorEnvelope,
  type QueueConfig,
} from '@nitejar/plugin-handlers'
import type { Agent } from '@nitejar/database'

/** Per-agent stagger added on queued dispatch debounce to avoid simultaneous starts. */
export const QUEUE_AGENT_STAGGER_MS = 5000

/**
 * Extract queue config from plugin instance config JSON, with defaults.
 */
export function extractQueueConfig(pluginInstanceConfig: string | null): QueueConfig {
  if (!pluginInstanceConfig) return DEFAULT_QUEUE_CONFIG
  try {
    const parsedUnknown: unknown = JSON.parse(pluginInstanceConfig)
    const parsed =
      parsedUnknown && typeof parsedUnknown === 'object' && !Array.isArray(parsedUnknown)
        ? (parsedUnknown as Record<string, unknown>)
        : {}
    const q = parsed.queue as Partial<QueueConfig> | undefined
    if (!q) return DEFAULT_QUEUE_CONFIG
    return {
      mode: q.mode ?? DEFAULT_QUEUE_CONFIG.mode,
      debounceMs: q.debounceMs ?? DEFAULT_QUEUE_CONFIG.debounceMs,
      maxQueued: q.maxQueued ?? DEFAULT_QUEUE_CONFIG.maxQueued,
    }
  } catch {
    return DEFAULT_QUEUE_CONFIG
  }
}

export function resolveOriginAgentId(
  actor: InboundActorEnvelope | undefined,
  agents: Agent[]
): string | null {
  if (!actor || actor.kind !== 'agent') {
    return null
  }

  if (actor.agentId && agents.some((agent) => agent.id === actor.agentId)) {
    return actor.agentId
  }

  if (actor.handle) {
    const normalized = actor.handle.toLowerCase()
    const byHandle = agents.find((agent) => agent.handle.toLowerCase() === normalized)
    if (byHandle) return byHandle.id
  }

  return null
}

export function filterOriginAgent(agents: Agent[], originAgentId: string | null): Agent[] {
  if (!originAgentId) return agents
  return agents.filter((agent) => agent.id !== originAgentId)
}
