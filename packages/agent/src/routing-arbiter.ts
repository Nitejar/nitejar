import type OpenAI from 'openai'
import type { Agent } from '@nitejar/database'
import { parseAgentConfig } from './config'
import { getModelConfig } from './prompt-builder'
import { getClient, withProviderRetry } from './model-client'
import { escapeXmlText, sanitize } from './prompt-sanitize'

export type RoutingMode = 'triage' | 'steer'
export type RoutingRoute = 'respond' | 'pass' | 'interrupt_now' | 'do_not_interrupt' | 'ignore'
export type RoutingOutcome = 'ok' | 'empty_response' | 'invalid_json' | 'error'

export interface RoutingUsage {
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number | null
  durationMs: number
}

export interface RunRoutingArbiterInput {
  mode: RoutingMode
  agent: Agent
  targetName: string
  targetHandle?: string
  targetTitle?: string | null
  userPrompt: string
  recentHistory?: string | null
  teamContext?: string
  activeWorkSnapshot?: string
  ingressContext?: string
  rules: string[]
  allowedRoutes: RoutingRoute[]
  defaultRoute: RoutingRoute
  defaultReason: string
  uncertaintyReason: string
  reasonMaxChars: number
  maxTokensDefault: number
  maxTokensCap?: number
  retryLabel: string
}

export interface RunRoutingArbiterResult {
  outcome: RoutingOutcome
  route: RoutingRoute
  reason: string
  reasonAutoDerived: boolean
  resources: string[]
  readonly: boolean
  parsed: Record<string, unknown> | null
  rawResponse: string | null
  usage: RoutingUsage | null
  requestPayload: unknown
  responsePayload: unknown
}

function stripMarkdownFence(value: string): string {
  return value.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '')
}

function coerceParsedObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function parseJsonObjectCandidate(value: string): Record<string, unknown> | null {
  try {
    return coerceParsedObject(JSON.parse(value))
  } catch {
    return null
  }
}

function parseLooseJson(raw: string): Record<string, unknown> | null {
  const cleaned = stripMarkdownFence(raw).trim()
  if (!cleaned) {
    return null
  }

  const direct = parseJsonObjectCandidate(cleaned)
  if (direct) {
    return direct
  }

  let depth = 0
  let start = -1
  let inString = false
  let escaping = false

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i]

    if (inString) {
      if (escaping) {
        escaping = false
        continue
      }
      if (char === '\\') {
        escaping = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) {
        start = i
      }
      depth += 1
      continue
    }
    if (char === '}') {
      if (depth === 0) {
        continue
      }
      depth -= 1
      if (depth === 0 && start >= 0) {
        const candidate = cleaned.slice(start, i + 1)
        const parsed = parseJsonObjectCandidate(candidate)
        if (parsed) {
          return parsed
        }
        start = -1
      }
    }
  }

  return null
}

function normalizeRouteLabel(raw: string): RoutingRoute | null {
  const value = raw.trim().toLowerCase()
  if (value === 'respond' || value === 'reply' || value === 'act' || value === 'handle') {
    return 'respond'
  }
  if (
    value === 'pass' ||
    value === 'defer' ||
    value === 'do_not_respond' ||
    value === 'do-not-respond'
  ) {
    return 'pass'
  }
  if (
    value === 'interrupt_now' ||
    value === 'inject_now' ||
    value === 'interrupt' ||
    value === 'steer'
  ) {
    return 'interrupt_now'
  }
  if (value === 'do_not_interrupt' || value === 'queue') {
    return 'do_not_interrupt'
  }
  if (value === 'ignore' || value === 'drop' || value === 'skip') {
    return 'ignore'
  }
  return null
}

function coerceRouteFromParsed(
  parsed: Record<string, unknown>,
  allowedRoutes: RoutingRoute[],
  defaultRoute: RoutingRoute
): RoutingRoute {
  const routeLabel =
    typeof parsed.route === 'string'
      ? parsed.route
      : typeof parsed.decision === 'string'
        ? parsed.decision
        : null
  if (routeLabel) {
    const normalized = normalizeRouteLabel(routeLabel)
    if (normalized && allowedRoutes.includes(normalized)) {
      return normalized
    }
  }

  if (typeof parsed.respond === 'boolean') {
    const fromRespond: RoutingRoute = parsed.respond ? 'respond' : 'pass'
    if (allowedRoutes.includes(fromRespond)) {
      return fromRespond
    }
  }

  return defaultRoute
}

function buildSystemPrompt(input: RunRoutingArbiterInput): string {
  const role = input.targetTitle ? ` (${input.targetTitle})` : ''
  const optionalExclusiveSchema = input.mode === 'triage' ? ', "exclusive"?: boolean' : ''
  const triageDecisionFraming =
    input.mode === 'triage'
      ? [
          'Decision question: should the target agent respond to THIS incoming message immediately, or wait/pass for now?',
          'Multiple agents can respond at once and may produce duplicate answers.',
          'To prevent multiple agent replies for this work item turn, use exclusive access:',
          '- Set route="pass" when another agent should take this turn.',
          '- Set route="respond" and "exclusive": true only when this target agent should be the sole responder for this turn.',
        ]
      : []
  const sections: string[] = [
    `You are a runtime routing arbiter for ${input.targetName}${role}.`,
    input.targetHandle ? `Target agent handle: @${input.targetHandle}.` : '',
    'You are not writing a user-visible reply. You only classify routing for this target agent.',
    ...triageDecisionFraming,
    '',
    'Return EXACTLY one JSON object. No markdown. No prose. No code fences.',
    `Schema: {"route": ${input.allowedRoutes.map((r) => `"${r}"`).join(' | ')}, "readonly": boolean, "reason": string, "resources": string[]${optionalExclusiveSchema}}`,
    '',
    'Rules:',
    `- "reason" must be non-empty and specific (<= ${input.reasonMaxChars} chars).`,
    '- "resources" should include only clearly referenced IDs/paths; otherwise [].',
    '- Classify for the target agent only. Do not roleplay as the target agent.',
    ...input.rules.map((line) => `- ${line}`),
    `- If uncertain, choose route="${input.defaultRoute}" with reason="${input.uncertaintyReason}".`,
  ]

  if (input.activeWorkSnapshot) {
    sections.push(
      '',
      '<target_active_work>',
      escapeXmlText(input.activeWorkSnapshot),
      '</target_active_work>'
    )
  }
  if (input.ingressContext) {
    sections.push(
      '',
      '<ingress_context>',
      escapeXmlText(input.ingressContext),
      '</ingress_context>'
    )
  }
  if (input.teamContext) {
    sections.push(
      '',
      '<team_and_dispatch_context>',
      escapeXmlText(input.teamContext),
      '</team_and_dispatch_context>'
    )
  }
  if (input.recentHistory) {
    sections.push(
      '',
      '<recent_conversation>',
      escapeXmlText(input.recentHistory),
      '</recent_conversation>'
    )
  }

  return sections.filter(Boolean).join('\n')
}

function parseRoutingResponse(
  content: string,
  input: RunRoutingArbiterInput
): Omit<
  RunRoutingArbiterResult,
  'usage' | 'rawResponse' | 'outcome' | 'requestPayload' | 'responsePayload'
> | null {
  const parsed = parseLooseJson(content)
  if (!parsed) return null

  const route = coerceRouteFromParsed(parsed, input.allowedRoutes, input.defaultRoute)
  const resources = Array.isArray(parsed.resources)
    ? parsed.resources.filter((value): value is string => typeof value === 'string')
    : []
  const providedReason = typeof parsed.reason === 'string' ? parsed.reason.trim() : ''
  const reason = (providedReason.length > 0 ? providedReason : input.defaultReason).slice(
    0,
    input.reasonMaxChars
  )

  return {
    route,
    reason,
    reasonAutoDerived: providedReason.length === 0,
    resources,
    readonly: parsed.readonly === true,
    parsed,
  }
}

function normalizeUsage(
  usage: OpenAI.CompletionUsage | undefined,
  model: string,
  durationMs: number
): RoutingUsage {
  const openRouterCost = (usage as Record<string, unknown> | undefined)?.cost
  return {
    model,
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0),
    costUsd: typeof openRouterCost === 'number' ? openRouterCost : 0,
    durationMs,
  }
}

export async function runRoutingArbiter(
  input: RunRoutingArbiterInput
): Promise<RunRoutingArbiterResult> {
  const config = parseAgentConfig(input.agent.config)
  const modelConfig = getModelConfig(config)
  const triageSettings = config.triageSettings
  const maxTokensPreCap = triageSettings?.maxTokens ?? input.maxTokensDefault
  const maxTokens =
    input.maxTokensCap != null
      ? Math.max(150, Math.min(maxTokensPreCap, input.maxTokensCap))
      : maxTokensPreCap
  const reasoningEffort = triageSettings?.reasoningEffort

  const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
    reasoning?: { effort: 'low' | 'medium' | 'high' }
  } = {
    model: modelConfig.model,
    max_tokens: maxTokens,
    temperature: 0,
    messages: [
      { role: 'system', content: buildSystemPrompt(input) },
      { role: 'user', content: sanitize(input.userPrompt) },
    ],
  }
  if (reasoningEffort) {
    request.reasoning = { effort: reasoningEffort }
  }

  try {
    const client = await getClient()
    let responsePayload: unknown = null

    const startedAt = Date.now()
    const response = await withProviderRetry(
      () =>
        client.chat.completions.create(
          request as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
        ),
      { maxRetries: 1, label: input.retryLabel }
    )
    responsePayload = response
    const durationMs = Date.now() - startedAt
    const content = response.choices?.[0]?.message?.content?.trim() ?? ''
    const usage = normalizeUsage(response.usage, response.model || modelConfig.model, durationMs)

    if (!content) {
      return {
        outcome: 'empty_response',
        route: input.defaultRoute,
        reason: input.defaultReason,
        reasonAutoDerived: true,
        resources: [],
        readonly: true,
        parsed: null,
        rawResponse: null,
        usage,
        requestPayload: request,
        responsePayload,
      }
    }

    const parsed = parseRoutingResponse(content, input)
    if (!parsed) {
      return {
        outcome: 'invalid_json',
        route: input.defaultRoute,
        reason: input.defaultReason,
        reasonAutoDerived: true,
        resources: [],
        readonly: true,
        parsed: null,
        rawResponse: content,
        usage,
        requestPayload: request,
        responsePayload,
      }
    }

    return {
      outcome: 'ok',
      route: parsed.route,
      reason: parsed.reason,
      reasonAutoDerived: parsed.reasonAutoDerived,
      resources: parsed.resources,
      readonly: parsed.readonly,
      parsed: parsed.parsed,
      rawResponse: content,
      usage,
      requestPayload: request,
      responsePayload,
    }
  } catch {
    return {
      outcome: 'error',
      route: input.defaultRoute,
      reason: input.defaultReason,
      reasonAutoDerived: true,
      resources: [],
      readonly: true,
      parsed: null,
      rawResponse: null,
      usage: null,
      requestPayload: request,
      responsePayload: null,
    }
  }
}

export const __routingArbiterTest = {
  stripMarkdownFence,
  parseLooseJson,
  normalizeRouteLabel,
  coerceRouteFromParsed,
  buildSystemPrompt,
  parseRoutingResponse,
  normalizeUsage,
}
