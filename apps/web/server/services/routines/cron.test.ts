import { describe, expect, it } from 'vitest'
import { assertMinimumCronInterval, validateCronSchedule } from './cron'

describe('routine cron validation', () => {
  it('rejects cron expressions faster than 5 minutes', () => {
    expect(() => assertMinimumCronInterval('* * * * *', 'UTC')).toThrow(
      'Cron schedule must not run more than once every 5 minutes.'
    )
  })

  it('accepts 5-minute cadence and computes next run', () => {
    const next = validateCronSchedule('*/5 * * * *', 'UTC')
    expect(next).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })
})
