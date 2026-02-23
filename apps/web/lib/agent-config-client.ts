export type AgentIdentityConfig = {
  emoji?: string
  avatarUrl?: string
}

/**
 * Client-safe parser for display-only agent identity fields.
 * Keep this intentionally narrow so client routes don't pull server agent modules.
 */
export function parseAgentIdentityConfig(configJson: string | null): AgentIdentityConfig {
  if (!configJson) return {}

  try {
    const parsed: unknown = JSON.parse(configJson)
    if (!parsed || typeof parsed !== 'object') return {}

    const source = parsed as Record<string, unknown>
    const result: AgentIdentityConfig = {}
    if (typeof source.emoji === 'string') result.emoji = source.emoji
    if (typeof source.avatarUrl === 'string') result.avatarUrl = source.avatarUrl
    return result
  } catch {
    return {}
  }
}
