import { describe, it, expect } from 'vitest'
import { testHandler, createMockPluginInstance, createMockRequest } from '../src/testing'
import type { PluginHandler, PluginExport } from '../src/types'

// A valid minimal handler for testing
function createValidHandler(overrides?: Partial<PluginHandler>): PluginHandler {
  return {
    type: 'test-plugin',
    displayName: 'Test Plugin',
    description: 'A test plugin',
    icon: 'test',
    category: 'productivity',
    sensitiveFields: [],
    validateConfig: () => ({ valid: true }),
    parseWebhook: async () => ({
      shouldProcess: true,
      workItem: { session_key: 'test', source: 'test', source_ref: 'ref-1', title: 'Test' },
    }),
    postResponse: async () => ({ success: true, outcome: 'sent' }),
    ...overrides,
  }
}

describe('createMockPluginInstance', () => {
  it('returns defaults when no overrides', () => {
    const inst = createMockPluginInstance()
    expect(inst.id).toBe('test-001')
    expect(inst.type).toBe('test')
    expect(inst.config).toBeNull()
  })

  it('merges overrides', () => {
    const inst = createMockPluginInstance({ id: 'custom', config: '{"key":"val"}' })
    expect(inst.id).toBe('custom')
    expect(inst.config).toBe('{"key":"val"}')
  })
})

describe('createMockRequest', () => {
  it('creates a JSON POST request from an object', async () => {
    const req = createMockRequest({ text: 'hello' })
    expect(req.method).toBe('POST')
    expect(req.headers.get('content-type')).toBe('application/json')
    const body = await req.json()
    expect(body.text).toBe('hello')
  })

  it('respects custom headers and method', async () => {
    const req = createMockRequest('raw', { method: 'PUT', headers: { 'x-custom': 'yes' } })
    expect(req.method).toBe('PUT')
    expect(req.headers.get('x-custom')).toBe('yes')
  })
})

describe('testHandler', () => {
  it('passes all checks for a valid handler', async () => {
    const pluginExport: PluginExport = { handler: createValidHandler() }
    const result = await testHandler(pluginExport, {
      webhookBody: { text: 'hello' },
      postResponseArgs: { workItemId: 'wi-1', content: 'response' },
    })
    expect(result.definePlugin.pass).toBe(true)
    expect(result.validateConfig.pass).toBe(true)
    expect(result.parseWebhook?.pass).toBe(true)
    expect(result.postResponse?.pass).toBe(true)
  })

  it('fails at definePlugin for handler missing parseWebhook', async () => {
    const handler = createValidHandler()
    // @ts-expect-error Testing invalid handler
    delete handler.parseWebhook
    const result = await testHandler({ handler })
    expect(result.definePlugin.pass).toBe(false)
    expect(result.definePlugin.error).toContain('parseWebhook')
  })

  it('skips parseWebhook when no webhookBody provided', async () => {
    const pluginExport: PluginExport = { handler: createValidHandler() }
    const result = await testHandler(pluginExport)
    expect(result.parseWebhook).toBeUndefined()
    expect(result.postResponse).toBeUndefined()
  })

  it('reports validateConfig failure', async () => {
    const handler = createValidHandler({
      validateConfig: () => ({ valid: false, errors: ['bad config'] }),
    })
    const result = await testHandler({ handler })
    expect(result.validateConfig.pass).toBe(false)
    expect(result.validateConfig.result?.errors).toContain('bad config')
  })
})
