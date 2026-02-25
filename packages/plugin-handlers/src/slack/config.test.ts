import { describe, expect, it } from 'vitest'
import { slackHandler } from './index'

describe('Slack config validation', () => {
  it('accepts valid config', () => {
    const result = slackHandler.validateConfig({
      botToken: 'xoxb-test',
      signingSecret: 'secret',
      inboundPolicy: 'mentions',
    })

    expect(result.valid).toBe(true)
  })

  it('rejects missing credentials', () => {
    const result = slackHandler.validateConfig({ botToken: '' })
    expect(result.valid).toBe(false)
  })

  it('accepts manifest-pending setup without credentials', () => {
    const result = slackHandler.validateConfig({
      manifestPending: true,
      inboundPolicy: 'mentions',
    })

    expect(result.valid).toBe(true)
  })

  it('normalizes allowed channels from csv', () => {
    const result = slackHandler.validateConfig({
      botToken: 'xoxb-test',
      signingSecret: 'secret',
      allowedChannels: 'C111, C222',
    })

    expect(result.valid).toBe(true)
  })
})
