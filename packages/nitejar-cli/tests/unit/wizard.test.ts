import { describe, expect, it } from 'vitest'

import { shouldRunWizard } from '../../src/lib/wizard.js'

describe('shouldRunWizard', () => {
  it('returns true on first boot with TTY', () => {
    expect(shouldRunWizard(false, false, true)).toBe(true)
  })

  it('returns false when env file already exists', () => {
    expect(shouldRunWizard(true, false, true)).toBe(false)
  })

  it('returns false when --no-wizard is passed', () => {
    expect(shouldRunWizard(false, true, true)).toBe(false)
  })

  it('returns false when not a TTY', () => {
    expect(shouldRunWizard(false, false, false)).toBe(false)
  })
})
