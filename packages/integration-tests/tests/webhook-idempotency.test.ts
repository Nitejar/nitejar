import { describe, it, expect } from 'vitest'
import type { PluginHandler } from '@nitejar/plugin-handlers'
import { pluginHandlerRegistry, routeWebhook } from '@nitejar/plugin-handlers'
import { createPluginInstance, getDb } from '@nitejar/database'

const handlerType = 'integration-test-idempotency'

const handler: PluginHandler = {
  type: handlerType,
  displayName: 'Integration Test Idempotency',
  sensitiveFields: [],
  validateConfig: () => ({ valid: true }),
  parseWebhook: () =>
    Promise.resolve({
      shouldProcess: true,
      idempotencyKey: 'duplicate-key',
      workItem: {
        session_key: 'session-1',
        source: 'test',
        source_ref: 'ref-1',
        title: 'Webhook',
        payload: JSON.stringify({ ok: true }),
      },
    }),
  postResponse: () => Promise.resolve({ success: true }),
}

if (!pluginHandlerRegistry.has(handlerType)) {
  pluginHandlerRegistry.register(handler)
}

describe('webhook idempotency', () => {
  it('deduplicates repeated webhook payloads', async () => {
    const pluginInstance = await createPluginInstance({
      type: handlerType,
      name: 'Idempotency Test',
      config: null,
      scope: 'global',
      enabled: 1,
    })

    const makeRequest = () =>
      new Request('http://example.com', {
        method: 'POST',
        body: JSON.stringify({ event: 'test' }),
        headers: { 'content-type': 'application/json' },
      })

    const first = await routeWebhook(handlerType, pluginInstance.id, makeRequest())
    expect(first.status).toBe(201)

    const second = await routeWebhook(handlerType, pluginInstance.id, makeRequest())
    expect(second.status).toBe(200)
    expect(second.body).toEqual({ duplicate: true, workItemId: first.workItemId })

    const db = getDb()
    const items = await db.selectFrom('work_items').select(['id']).execute()
    expect(items).toHaveLength(1)
  })
})
