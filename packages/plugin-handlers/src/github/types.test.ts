import { describe, it, expect } from 'vitest'
import { githubHandler } from './index'

describe('GitHub config validation', () => {
  it('accepts app credentials', () => {
    const result = githubHandler.validateConfig({
      appId: '123',
      privateKey: 'key',
      webhookSecret: 'secret',
    })

    expect(result.valid).toBe(true)
  })

  it('rejects partial app credentials', () => {
    const result = githubHandler.validateConfig({ appId: '123' })

    expect(result.valid).toBe(false)
  })

  it('rejects missing app credentials when manifest is not pending', () => {
    const result = githubHandler.validateConfig({
      webhookSecret: 'secret',
    })

    expect(result.valid).toBe(false)
  })

  it('rejects partial client credentials', () => {
    const result = githubHandler.validateConfig({ clientId: 'client' })

    expect(result.valid).toBe(false)
  })

  it('accepts permissions preset and ttl', () => {
    const result = githubHandler.validateConfig({
      permissions: { preset: 'minimal' },
      tokenTTL: 3600,
      manifestPending: true,
    })

    expect(result.valid).toBe(true)
  })
})
