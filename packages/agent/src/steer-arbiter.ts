import type { Agent } from '@nitejar/database'
import { sanitize, sanitizeLabel } from './prompt-sanitize'
import { runRoutingArbiter } from './routing-arbiter'

const DEFAULT_ARBITER_MAX_TOKENS = 500
const DEFAULT_REASON = 'Arbiter defaulted to do_not_interrupt.'

export type SteerArbiterDecision = 'interrupt_now' | 'do_not_interrupt' | 'ignore'

export interface SteerArbiterMessage {
  text: string
  senderName: string
}

export interface SteerArbiterActiveWork {
  dispatchId: string
  status: string
  source: string
  sessionKey: string
  title: string
  createdAt: number
}

export interface SteerArbiterInput {
  agent: Agent
  queueKey: string
  sessionKey: string
  objectiveText: string
  pendingMessages: SteerArbiterMessage[]
  activeWork: SteerArbiterActiveWork[]
}

export interface SteerArbiterResult {
  decision: SteerArbiterDecision
  reason: string
  usage: {
    model: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    costUsd: number | null
    durationMs: number
  } | null
}

function buildArbiterUserPrompt(input: SteerArbiterInput): string {
  const objective = sanitize(input.objectiveText).slice(0, 2500)
  const pending = input.pendingMessages
    .map((m, idx) => `${idx + 1}. [${sanitizeLabel(m.senderName, 'User')}] ${sanitize(m.text)}`)
    .join('\n')
  const active =
    input.activeWork.length === 0
      ? '(none)'
      : input.activeWork
          .map(
            (w, idx) =>
              `${idx + 1}. ${sanitize(w.status)} | ${sanitize(w.source)} | ${sanitize(w.sessionKey)} | ${sanitize(w.title)}`
          )
          .join('\n')

  return [
    `Agent: @${sanitize(input.agent.handle)} (${sanitize(input.agent.name)})`,
    `Queue lane: ${sanitize(input.queueKey)}`,
    `Session: ${sanitize(input.sessionKey)}`,
    '',
    'Current objective (running now):',
    objective,
    '',
    'Pending incoming messages:',
    pending,
    '',
    'Other active work across channels:',
    active,
  ].join('\n')
}

export async function decideSteeringAction(input: SteerArbiterInput): Promise<SteerArbiterResult> {
  const routing = await runRoutingArbiter({
    mode: 'steer',
    agent: input.agent,
    targetName: input.agent.name,
    targetHandle: input.agent.handle,
    targetTitle: null,
    userPrompt: buildArbiterUserPrompt(input),
    rules: [
      'Mentions are intent signals, not hard routing locks.',
      'Distinguish directive mentions ("@you do X") from referential mentions ("@you did X").',
      'Referential mentions alone do not require immediate interruption.',
      'Use route="interrupt_now" when the latest message requires an immediate strategy change, stop, correction, or safety fix.',
      'Use route="do_not_interrupt" when relevant but not urgent; let normal queue flow handle it.',
      'Use route="ignore" only when confidently non-actionable/noise.',
      'Prefer route="do_not_interrupt" over route="interrupt_now" when urgency is unclear.',
    ],
    allowedRoutes: ['interrupt_now', 'do_not_interrupt', 'ignore'],
    defaultRoute: 'do_not_interrupt',
    defaultReason: DEFAULT_REASON,
    uncertaintyReason: DEFAULT_REASON,
    reasonMaxChars: 180,
    maxTokensDefault: DEFAULT_ARBITER_MAX_TOKENS,
    maxTokensCap: DEFAULT_ARBITER_MAX_TOKENS,
    retryLabel: 'steer-arbiter',
  })

  if (routing.outcome === 'error') {
    return {
      decision: 'do_not_interrupt',
      reason: 'Arbiter failed; defaulting to do_not_interrupt.',
      usage: null,
    }
  }

  if (routing.outcome === 'invalid_json' || routing.outcome === 'empty_response') {
    return {
      decision: 'do_not_interrupt',
      reason: 'Arbiter response was invalid JSON.',
      usage: routing.usage,
    }
  }

  return {
    decision: routing.route as SteerArbiterDecision,
    reason: routing.reason,
    usage: routing.usage,
  }
}
