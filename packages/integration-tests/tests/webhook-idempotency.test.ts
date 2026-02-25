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
  parseWebhook: async (request) => {
    const payload = (await request.json()) as {
      event?: string
      dedupeId?: string
      canonicalId?: string
      aliasId?: string
    }

    const dedupeId = payload.dedupeId ?? 'duplicate-key'
    const canonicalId = payload.canonicalId
    const aliasId = payload.aliasId

    return {
      shouldProcess: true,
      idempotencyKey: canonicalId ?? dedupeId,
      ...(aliasId ? { idempotencyKeys: [canonicalId ?? dedupeId, aliasId] } : {}),
      workItem: {
        session_key: 'session-1',
        source: 'test',
        source_ref: `ref-${payload.event ?? '1'}`,
        title: 'Webhook',
        payload: JSON.stringify({ ok: true }),
      },
    }
  },
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
        body: JSON.stringify({ event: 'repeat', dedupeId: 'duplicate-key' }),
        headers: { 'content-type': 'application/json' },
      })

    const first = await routeWebhook(handlerType, pluginInstance.id, makeRequest())
    expect(first.status).toBe(201)

    const second = await routeWebhook(handlerType, pluginInstance.id, makeRequest())
    expect(second.status).toBe(200)
    expect(second.body).toEqual({ duplicate: true, workItemId: first.workItemId })

    const db = getDb()
    const items = await db
      .selectFrom('work_items')
      .select(['id'])
      .where('plugin_instance_id', '=', pluginInstance.id)
      .execute()
    expect(items).toHaveLength(1)
  })

  it('deduplicates app_mention and message twins via canonical key aliases', async () => {
    const pluginInstance = await createPluginInstance({
      type: handlerType,
      name: 'Idempotency Alias Test',
      config: null,
      scope: 'global',
      enabled: 1,
    })

    const makeRequest = (event: string, aliasId: string) =>
      new Request('http://example.com', {
        method: 'POST',
        body: JSON.stringify({
          event,
          canonicalId: 'slack:v1:msg:T1:C1:1700000.321',
          aliasId,
        }),
        headers: { 'content-type': 'application/json' },
      })

    const appMention = await routeWebhook(
      handlerType,
      pluginInstance.id,
      makeRequest('app_mention', 'slack:event:EvA')
    )
    expect(appMention.status).toBe(201)

    const messageTwin = await routeWebhook(
      handlerType,
      pluginInstance.id,
      makeRequest('message', 'slack:event:EvB')
    )
    expect(messageTwin.status).toBe(200)
    expect(messageTwin.body).toEqual({ duplicate: true, workItemId: appMention.workItemId })

    const db = getDb()
    const items = await db
      .selectFrom('work_items')
      .select(['id'])
      .where('plugin_instance_id', '=', pluginInstance.id)
      .execute()
    expect(items).toHaveLength(1)
  })
})
