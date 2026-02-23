export type ArbiterDecisionTone = 'critical' | 'defer' | 'ignore' | 'neutral'

export interface ParsedArbiterReceipt {
  decision: string
  reason: string | null
}

export function parseArbiterControlReason(
  controlReason: string | null | undefined
): ParsedArbiterReceipt | null {
  if (!controlReason || !controlReason.startsWith('arbiter:')) {
    return null
  }

  const [, decision, ...reasonParts] = controlReason.split(':')
  const normalizedDecision = (decision ?? '').trim().toLowerCase()
  if (!normalizedDecision) return null

  const reason = reasonParts.join(':').trim()
  return {
    decision: normalizedDecision,
    reason: reason.length > 0 ? reason : null,
  }
}

export function formatArbiterDecisionLabel(decision: string): string {
  switch (decision) {
    case 'interrupt_now':
      return 'Interrupt Now'
    case 'do_not_interrupt':
      return 'Do Not Interrupt'
    case 'ignore':
      return 'Ignore'
    case 'exclusive_claim':
      return 'Exclusive Claim'
    default:
      return decision
        .split('_')
        .filter((part) => part.length > 0)
        .map((part) => part[0]!.toUpperCase() + part.slice(1))
        .join(' ')
  }
}

export function getArbiterDecisionTone(decision: string): ArbiterDecisionTone {
  switch (decision) {
    case 'interrupt_now':
      return 'critical'
    case 'do_not_interrupt':
      return 'defer'
    case 'ignore':
      return 'ignore'
    default:
      return 'neutral'
  }
}
