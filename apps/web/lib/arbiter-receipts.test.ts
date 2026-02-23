import { describe, expect, it } from 'vitest'
import {
  formatArbiterDecisionLabel,
  getArbiterDecisionTone,
  parseArbiterControlReason,
} from './arbiter-receipts'

describe('parseArbiterControlReason', () => {
  it('parses arbiter decisions and reasons', () => {
    expect(parseArbiterControlReason('arbiter:interrupt_now:urgent correction')).toEqual({
      decision: 'interrupt_now',
      reason: 'urgent correction',
    })
  })

  it('returns null for non-arbiter reasons', () => {
    expect(parseArbiterControlReason('resume_seed')).toBeNull()
    expect(parseArbiterControlReason(null)).toBeNull()
  })

  it('handles missing reason', () => {
    expect(parseArbiterControlReason('arbiter:ignore:')).toEqual({
      decision: 'ignore',
      reason: null,
    })
  })
})

describe('arbiter decision formatting', () => {
  it('formats labels', () => {
    expect(formatArbiterDecisionLabel('do_not_interrupt')).toBe('Do Not Interrupt')
    expect(formatArbiterDecisionLabel('exclusive_claim')).toBe('Exclusive Claim')
    expect(formatArbiterDecisionLabel('unknown_decision')).toBe('Unknown Decision')
  })

  it('maps tones', () => {
    expect(getArbiterDecisionTone('interrupt_now')).toBe('critical')
    expect(getArbiterDecisionTone('do_not_interrupt')).toBe('defer')
    expect(getArbiterDecisionTone('ignore')).toBe('ignore')
    expect(getArbiterDecisionTone('exclusive_claim')).toBe('neutral')
  })
})
