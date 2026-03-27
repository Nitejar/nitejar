export type AppSessionContextKind = 'standalone' | 'ticket' | 'goal' | 'routine'

export type ParsedAppSessionKey =
  | {
      isAppSession: true
      isLegacy: false
      raw: string
      contextKind: AppSessionContextKind
      contextId: string
      sessionId: string
      familyKey: string | null
      ownerUserId: string | null
    }
  | {
      isAppSession: true
      isLegacy: true
      raw: string
      contextKind: 'standalone'
      contextId: string
      sessionId: string
      familyKey: null
      ownerUserId: string
    }
  | {
      isAppSession: false
      isLegacy: false
      raw: string
      contextKind: null
      contextId: null
      sessionId: null
      familyKey: null
      ownerUserId: null
    }

const TYPED_APP_SESSION_RE = /^app:(standalone|ticket|goal|routine):([^:]+):([^:]+)$/
const LEGACY_APP_SESSION_RE = /^app:([^:]+):([^:]+)$/

export function buildStandaloneAppSessionKey(userId: string, sessionId: string): string {
  return `app:standalone:${userId}:${sessionId}`
}

export function buildTicketAppSessionKey(ticketId: string, sessionId: string): string {
  return `app:ticket:${ticketId}:${sessionId}`
}

export function buildGoalAppSessionKey(goalId: string, sessionId: string): string {
  return `app:goal:${goalId}:${sessionId}`
}

export function buildRoutineAppSessionKey(routineId: string, sessionId: string): string {
  return `app:routine:${routineId}:${sessionId}`
}

export function parseAppSessionKey(sessionKey: string): ParsedAppSessionKey {
  const typedMatch = sessionKey.match(TYPED_APP_SESSION_RE)
  if (typedMatch) {
    const contextKind = typedMatch[1] as AppSessionContextKind
    const contextId = typedMatch[2] ?? ''
    const sessionId = typedMatch[3] ?? ''
    return {
      isAppSession: true,
      isLegacy: false,
      raw: sessionKey,
      contextKind,
      contextId,
      sessionId,
      familyKey: contextKind === 'standalone' ? null : `app:${contextKind}:${contextId}`,
      ownerUserId: contextKind === 'standalone' ? contextId : null,
    }
  }

  const legacyMatch = sessionKey.match(LEGACY_APP_SESSION_RE)
  if (legacyMatch) {
    const ownerUserId = legacyMatch[1] ?? ''
    const sessionId = legacyMatch[2] ?? ''
    return {
      isAppSession: true,
      isLegacy: true,
      raw: sessionKey,
      contextKind: 'standalone',
      contextId: ownerUserId,
      sessionId,
      familyKey: null,
      ownerUserId,
    }
  }

  return {
    isAppSession: false,
    isLegacy: false,
    raw: sessionKey,
    contextKind: null,
    contextId: null,
    sessionId: null,
    familyKey: null,
    ownerUserId: null,
  }
}

export function isAppSessionKey(sessionKey: string): boolean {
  return parseAppSessionKey(sessionKey).isAppSession
}
