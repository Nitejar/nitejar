import { describe, expect, it } from 'vitest'
import { normalizeActivitySummary } from './activity-log'

describe('normalizeActivitySummary', () => {
  it('returns trimmed summary when provided', () => {
    expect(normalizeActivitySummary('  valid reason  ')).toBe('valid reason')
  })

  it('returns fallback when summary is blank', () => {
    expect(normalizeActivitySummary('   ', 'fallback reason')).toBe('fallback reason')
  })

  it('returns deterministic default when both summary and fallback are blank', () => {
    expect(normalizeActivitySummary('   ', '   ')).toBe('Auto-derived reason: no reason provided')
  })
})
