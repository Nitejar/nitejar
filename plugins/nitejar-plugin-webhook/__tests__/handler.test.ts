import { createHmac } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import plugin from '../src/index'

const { handler } = plugin

function makeInstance(config: unknown = null) {
  return {
    id: 'test-001',
    type: 'webhook',
    config: config ? JSON.stringify(config) : null,
  }
}

function jsonRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request('http://localhost/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('webhook plugin', () => {
  it('definePlugin() returns handler without throwing', () => {
    expect(plugin.handler).toBeDefined()
    expect(plugin.handler.type).toBe('webhook')
  })

  it('validateConfig({}) returns valid', () => {
    const result = handler.validateConfig({})
    expect(result.valid).toBe(true)
  })

  it('validateConfig(null) returns valid', () => {
    const result = handler.validateConfig(null)
    expect(result.valid).toBe(true)
  })

  it('validateConfig with non-object returns invalid', () => {
    const result = handler.validateConfig('bad')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Config must be an object or empty')
  })

  it('parseWebhook with JSON body returns shouldProcess: true + workItem', async () => {
    const body = { text: 'hello world', sender_id: 'user-1', sender_name: 'Alice' }
    const request = jsonRequest(body)
    const instance = makeInstance()

    const result = await handler.parseWebhook(request, instance)

    expect(result.shouldProcess).toBe(true)
    expect(result.workItem).toBeDefined()
    expect(result.workItem!.title).toBe('hello world')
    expect(result.workItem!.source).toBe('webhook')
    expect(result.workItem!.session_key).toBe('webhook:user-1')
    expect(result.idempotencyKey).toBeDefined()
  })

  it('parseWebhook with bad HMAC returns shouldProcess: false', async () => {
    const body = { text: 'secret payload' }
    const request = jsonRequest(body, { 'x-webhook-signature': 'deadbeef' })
    const instance = makeInstance({ secret: 'test-secret' })

    const result = await handler.parseWebhook(request, instance)

    expect(result.shouldProcess).toBe(false)
  })

  it('parseWebhook with valid HMAC returns shouldProcess: true', async () => {
    const body = { text: 'signed payload' }
    const bodyStr = JSON.stringify(body)
    const secret = 'test-secret'
    const sig = createHmac('sha256', secret).update(bodyStr).digest('hex')

    const request = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-signature': sig },
      body: bodyStr,
    })
    const instance = makeInstance({ secret })

    const result = await handler.parseWebhook(request, instance)

    expect(result.shouldProcess).toBe(true)
    expect(result.workItem).toBeDefined()
    expect(result.workItem!.title).toBe('signed payload')
  })

  it('parseWebhook with missing signature when secret required returns shouldProcess: false', async () => {
    const body = { text: 'no sig' }
    const request = jsonRequest(body)
    const instance = makeInstance({ secret: 'test-secret' })

    const result = await handler.parseWebhook(request, instance)

    expect(result.shouldProcess).toBe(false)
  })

  it('parseWebhook with non-JSON body returns shouldProcess: false', async () => {
    const request = new Request('http://localhost/webhook', {
      method: 'POST',
      body: 'not json at all',
    })
    const instance = makeInstance()

    const result = await handler.parseWebhook(request, instance)

    expect(result.shouldProcess).toBe(false)
  })

  it('postResponse returns success', async () => {
    const instance = makeInstance()
    const result = await handler.postResponse(instance, 'wi-123', 'response text')

    expect(result.success).toBe(true)
    expect(result.outcome).toBe('sent')
  })
})
