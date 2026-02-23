import type { Agent, WorkItem } from '@nitejar/database'
import { buildUserMessage, buildIssuePreamble } from './prompt-builder'
import { agentWarn } from './agent-logger'
import { logTriage } from './triage-log'
import { runRoutingArbiter } from './routing-arbiter'

const DEFAULT_TRIAGE_MAX_TOKENS = 4000

export interface TriageUsage {
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number | null
  durationMs: number
}

export interface TriageResult {
  isReadOnly: boolean
  reason: string
  reasonAutoDerived: boolean
  resources: string[]
  usage: TriageUsage | null
  /** Whether this agent should respond to the message (default: true). False = pass. */
  shouldRespond: boolean
  /** Optional "volunteer to be sole responder" signal for this work item. */
  exclusiveClaim?: boolean
  requestPayload: unknown
  responsePayload: unknown
}

const TRIAGE_REASON_REQUIRED_PASS_REASON =
  'Passing: triage response did not provide an explicit reason.'

const TRIAGE_PARSE_ERROR_PASS_REASON = 'Passing: triage response was invalid JSON.'

const TRIAGE_EMPTY_RESPONSE_PASS_REASON = 'Passing: triage response was empty.'

const TRIAGE_ERROR_PASS_REASON = 'Passing: triage failed before classification.'

/**
 * Additional context for triage — agent identity and session history.
 * Built by the runner before the triage call.
 */
export interface TriageContext {
  /** Agent display name */
  agentName: string
  /** Agent handle (without @) */
  agentHandle?: string
  /** Agent role/title (from config) */
  agentTitle: string | null
  /** Condensed recent conversation history (user/assistant text only) */
  recentHistory: string | null
  /** Team context: recent activity from other agents on this session */
  teamContext?: string
  /** Active work snapshot across plugin instances for this same agent */
  activeWorkSnapshot?: string
}

function normalizeForDuplicateComparison(value: string): string {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^\[session:\s*[^\]]+\]$/i.test(line))
    .map((line) =>
      line
        .replace(/^(?:User|You):\s*/i, '')
        .replace(/^\[@[^\]]+\]:\s*/i, '')
        .replace(/^\[[^\]]+\]\s*/, '')
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function dedupeRecentHistory(
  triageContext: TriageContext | undefined,
  userContent: string
): TriageContext | undefined {
  if (!triageContext?.recentHistory) return triageContext

  const normalizedUser = normalizeForDuplicateComparison(userContent)
  if (!normalizedUser) return triageContext

  const historyLines = triageContext.recentHistory
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  while (historyLines.length > 0) {
    const lastLine = historyLines[historyLines.length - 1]
    if (!lastLine) break
    const normalizedLast = normalizeForDuplicateComparison(lastLine)
    if (!normalizedLast || normalizedLast !== normalizedUser) {
      break
    }
    historyLines.pop()
  }

  return {
    ...triageContext,
    recentHistory: historyLines.length > 0 ? historyLines.join('\n') : null,
  }
}

function extractExclusiveDispatchLine(teamContext: string | undefined): string | null {
  if (!teamContext) return null
  const line = teamContext
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => /^Exclusive responder volunteer for this work item:/i.test(entry))
  return line ?? null
}

function mergeArbiterTranscriptContext(
  recentHistory: string | null | undefined,
  teamContext: string | undefined
): string | null {
  const exclusiveDispatchLine = extractExclusiveDispatchLine(teamContext)
  const base = recentHistory?.trim() || null
  if (!exclusiveDispatchLine) return base

  const syntheticLine = `System: [dispatch] ${exclusiveDispatchLine}`
  if (base && base.includes(syntheticLine)) return base
  return base ? `${base}\n${syntheticLine}` : syntheticLine
}

function extractExclusiveClaim(parsed: Record<string, unknown> | null): boolean {
  if (!parsed) return false
  return (
    parsed.exclusive === true ||
    parsed.exclusive_claim === true ||
    parsed.exclusiveClaim === true ||
    parsed.volunteer_exclusive === true
  )
}

/**
 * Lightweight triage of incoming work — classifies intent before the full inference loop.
 * Uses the agent's own model with a small max_tokens to keep it cheap.
 * Fails closed for responding: on malformed triage output or errors, returns pass.
 */
export async function triageWorkItem(
  agent: Agent,
  workItem: WorkItem,
  coalescedText?: string,
  triageContext?: TriageContext
): Promise<TriageResult> {
  // Use full user message (with sender context, reply context, etc.) instead of bare title
  const userContent = coalescedText || buildUserMessage(workItem)
  const effectiveTriageContext = dedupeRecentHistory(triageContext, userContent)
  const recentHistoryForArbiter = mergeArbiterTranscriptContext(
    effectiveTriageContext?.recentHistory,
    effectiveTriageContext?.teamContext
  )

  // For GitHub issues/PRs, prepend the issue context so the triage knows
  // what the conversation is about (who was addressed, what was requested).
  const issuePreamble = buildIssuePreamble(workItem)
  const issuePreambleText =
    issuePreamble && typeof issuePreamble.content === 'string'
      ? issuePreamble.content + '\n\n---\n\n'
      : ''
  const contextHint = workItem.session_key ? `\n[session: ${workItem.session_key}]` : ''

  const routing = await runRoutingArbiter({
    mode: 'triage',
    agent,
    targetName: effectiveTriageContext?.agentName ?? agent.name,
    targetHandle: effectiveTriageContext?.agentHandle ?? agent.handle,
    targetTitle: effectiveTriageContext?.agentTitle ?? null,
    userPrompt: issuePreambleText + userContent + contextHint,
    recentHistory: recentHistoryForArbiter,
    teamContext: effectiveTriageContext?.teamContext,
    activeWorkSnapshot: effectiveTriageContext?.activeWorkSnapshot,
    rules: [
      'Mentions are intent signals, not hard routing locks.',
      'Distinguish directive mentions ("@you do X") from referential mentions ("@you did X").',
      'Referential mentions alone do not require a response.',
      'If directly addressed by the target agent name/handle with a request, set route="respond".',
      'If clearly addressed only to a different agent for action, set route="pass".',
      'Ongoing shared exchanges (counting, brainstorming, turn-by-turn collaboration) are relevant even without a fresh @mention.',
      'If the latest message is a direct continuation of the target agent\'s recent turn or baton handoff, set route="respond".',
      'If team/dispatch context states a different agent is the exclusive responder for this work item, set route="pass" unless direct user override exists.',
      'When passing due to another agent exclusive responder, make reason explicit that you are waiting for that agent to finish this work item turn.',
      'After that exclusive responder posts, re-evaluate on the next incoming turn; do not treat exclusivity as permanent.',
      'When route="respond" and this target agent should be sole responder for this work item, include "exclusive": true. Otherwise include "exclusive": false.',
      'If ambiguous/shared, use judgment; prefer route="respond" only when the target agent can add unique value.',
    ],
    allowedRoutes: ['respond', 'pass'],
    defaultRoute: 'pass',
    defaultReason: TRIAGE_REASON_REQUIRED_PASS_REASON,
    uncertaintyReason: 'Unable to classify confidently',
    reasonMaxChars: 140,
    maxTokensDefault: DEFAULT_TRIAGE_MAX_TOKENS,
    retryLabel: 'triage',
  })

  let result: TriageResult
  let logError: string | undefined
  switch (routing.outcome) {
    case 'empty_response':
      result = {
        isReadOnly: true,
        reason: TRIAGE_EMPTY_RESPONSE_PASS_REASON,
        reasonAutoDerived: true,
        resources: [],
        usage: null,
        shouldRespond: false,
        exclusiveClaim: false,
        requestPayload: routing.requestPayload,
        responsePayload: routing.responsePayload,
      }
      break
    case 'invalid_json':
      result = {
        isReadOnly: true,
        reason: TRIAGE_PARSE_ERROR_PASS_REASON,
        reasonAutoDerived: true,
        resources: [],
        usage: routing.usage,
        shouldRespond: false,
        exclusiveClaim: false,
        requestPayload: routing.requestPayload,
        responsePayload: routing.responsePayload,
      }
      break
    case 'error':
      agentWarn('Triage failed, falling back to read-only', {
        error: TRIAGE_ERROR_PASS_REASON,
      })
      result = {
        isReadOnly: true,
        reason: TRIAGE_ERROR_PASS_REASON,
        reasonAutoDerived: true,
        resources: [],
        usage: null,
        shouldRespond: false,
        exclusiveClaim: false,
        requestPayload: routing.requestPayload,
        responsePayload: routing.responsePayload,
      }
      logError = TRIAGE_ERROR_PASS_REASON
      break
    case 'ok':
    default: {
      const shouldRespond = routing.route === 'respond'
      const exclusiveClaim = shouldRespond ? extractExclusiveClaim(routing.parsed) : false
      if (shouldRespond && routing.reasonAutoDerived) {
        result = {
          isReadOnly: true,
          reason: TRIAGE_REASON_REQUIRED_PASS_REASON,
          reasonAutoDerived: true,
          resources: routing.resources,
          usage: routing.usage,
          shouldRespond: false,
          exclusiveClaim: false,
          requestPayload: routing.requestPayload,
          responsePayload: routing.responsePayload,
        }
      } else {
        result = {
          isReadOnly: routing.readonly,
          reason: routing.reason,
          reasonAutoDerived: routing.reasonAutoDerived,
          resources: routing.resources,
          usage: routing.usage,
          shouldRespond,
          exclusiveClaim,
          requestPayload: routing.requestPayload,
          responsePayload: routing.responsePayload,
        }
      }
      break
    }
  }

  logTriage({
    timestamp: new Date().toISOString(),
    agentId: agent.id,
    agentHandle: agent.handle,
    workItemId: workItem.id,
    sessionKey: workItem.session_key,
    source: workItem.source,
    model: routing.usage?.model ?? 'unknown',
    rawResponse: routing.rawResponse,
    result: {
      isReadOnly: result.isReadOnly,
      shouldRespond: result.shouldRespond,
      exclusiveClaim: result.exclusiveClaim === true,
      reason: result.reason,
      reasonAutoDerived: result.reasonAutoDerived,
      resources: result.resources,
    },
    usage: result.usage
      ? {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
          costUsd: result.usage.costUsd,
          durationMs: result.usage.durationMs,
        }
      : null,
    ...(logError ? { error: logError } : {}),
  })

  return result
}

export const __triageTest = {
  normalizeForDuplicateComparison,
  dedupeRecentHistory,
  extractExclusiveDispatchLine,
  mergeArbiterTranscriptContext,
  extractExclusiveClaim,
}
