import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFindPluginInstanceById,
  mockFindIdempotencyKeyByAnyKey,
  mockCreateIdempotencyKeysIgnoreConflicts,
  mockCreateWorkItem,
  mockCreatePluginEvent,
  mockDecryptConfig,
  mockRegistryGet,
  mockParseWebhook,
} = vi.hoisted(() => ({
  mockFindPluginInstanceById: vi.fn(),
  mockFindIdempotencyKeyByAnyKey: vi.fn(),
  mockCreateIdempotencyKeysIgnoreConflicts: vi.fn(),
  mockCreateWorkItem: vi.fn(),
  mockCreatePluginEvent: vi.fn(),
  mockDecryptConfig: vi.fn(),
  mockRegistryGet: vi.fn(),
  mockParseWebhook: vi.fn(),
}))

vi.mock('@nitejar/database', () => ({
  findPluginInstanceById: mockFindPluginInstanceById,
  findIdempotencyKeyByAnyKey: mockFindIdempotencyKeyByAnyKey,
  createIdempotencyKeysIgnoreConflicts: mockCreateIdempotencyKeysIgnoreConflicts,
  createWorkItem: mockCreateWorkItem,
  createPluginEvent: mockCreatePluginEvent,
  decryptConfig: mockDecryptConfig,
}))

vi.mock('./registry', () => ({
  pluginHandlerRegistry: {
    get: mockRegistryGet,
  },
}))

import { routeWebhook } from './router'

const pluginInstance = {
  id: 'plugin-instance-1',
  plugin_id: 'builtin.slack',
  type: 'slack',
  name: 'Slack',
  config: JSON.stringify({ botToken: 'xoxb-token' }),
  enabled: 1,
  created_at: 1,
  updated_at: 1,
}

describe('routeWebhook idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockFindPluginInstanceById.mockResolvedValue(pluginInstance)
    mockDecryptConfig.mockReturnValue({ botToken: 'xoxb-token' })
    mockFindIdempotencyKeyByAnyKey.mockResolvedValue(null)
    mockCreateIdempotencyKeysIgnoreConflicts.mockResolvedValue(undefined)
    mockCreatePluginEvent.mockResolvedValue(null)
    mockCreateWorkItem.mockResolvedValue({ id: 'wi-new' })

    mockRegistryGet.mockReturnValue({
      sensitiveFields: [],
      parseWebhook: mockParseWebhook,
    })
  })

  it('deduplicates when any idempotency alias key already exists', async () => {
    mockParseWebhook.mockResolvedValue({
      shouldProcess: true,
      idempotencyKey: 'slack:v1:msg:T1:C1:1700000.123',
      idempotencyKeys: ['slack:event:Ev123'],
      ingressEventId: 'Ev123',
      workItem: {
        session_key: 'slack:C1:1700000.123',
        source: 'slack',
        source_ref: 'slack:C1:1700000.123',
        title: 'Hello',
        payload: JSON.stringify({ body: 'Hello' }),
        status: 'NEW',
      },
    })
    mockFindIdempotencyKeyByAnyKey.mockResolvedValue({
      key: 'slack:event:Ev123',
      work_item_id: 'wi-existing',
      created_at: 1,
    })

    const result = await routeWebhook(
      'slack',
      'plugin-instance-1',
      new Request('http://example.com', { method: 'POST', body: '{}' })
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ duplicate: true, workItemId: 'wi-existing' })
    expect(mockCreateWorkItem).not.toHaveBeenCalled()

    const duplicateEvent = (
      mockCreatePluginEvent.mock.calls as Array<[Record<string, unknown>]>
    ).find(([input]) => input.kind === 'webhook_ingress' && input.status === 'duplicate')?.[0]
    expect(duplicateEvent?.work_item_id).toBe('wi-existing')
    expect(duplicateEvent).toBeDefined()
    const detail = JSON.parse(duplicateEvent!.detail_json as string) as Record<string, unknown>
    expect(detail.matchedKey).toBe('slack:event:Ev123')
  })

  it('records all normalized idempotency keys on accepted webhook creation', async () => {
    mockParseWebhook.mockResolvedValue({
      shouldProcess: true,
      idempotencyKey: 'k-primary',
      idempotencyKeys: ['k-alias', 'k-primary', ''],
      ingressEventId: 'Ev200',
      workItem: {
        session_key: 'slack:C1:1700000.200',
        source: 'slack',
        source_ref: 'slack:C1:1700000.200',
        title: 'Hello again',
        payload: JSON.stringify({ body: 'Hello again' }),
        status: 'NEW',
      },
    })

    const result = await routeWebhook(
      'slack',
      'plugin-instance-1',
      new Request('http://example.com', { method: 'POST', body: '{}' })
    )

    expect(result.status).toBe(201)
    expect(mockCreateWorkItem).toHaveBeenCalledTimes(1)
    expect(mockCreateIdempotencyKeysIgnoreConflicts).toHaveBeenCalledTimes(1)

    const [keys, workItemId] = mockCreateIdempotencyKeysIgnoreConflicts.mock.calls[0] as [
      string[],
      string,
    ]
    expect(workItemId).toBe('wi-new')
    expect(keys).toHaveLength(2)
    expect(keys).toEqual(expect.arrayContaining(['k-primary', 'k-alias']))

    const acceptedEvent = (
      mockCreatePluginEvent.mock.calls as Array<[Record<string, unknown>]>
    ).find(([input]) => input.kind === 'webhook_ingress' && input.status === 'accepted')?.[0]
    expect(acceptedEvent?.work_item_id).toBe('wi-new')
  })

  it('records skipped ingress receipts with parser reason metadata', async () => {
    mockParseWebhook.mockResolvedValue({
      shouldProcess: false,
      ingressReasonCode: 'inbound_policy_filtered',
      ingressReasonText: 'Slack event did not pass inbound policy.',
      ingressEventId: 'EvSkip',
    })

    const result = await routeWebhook(
      'slack',
      'plugin-instance-1',
      new Request('http://example.com', { method: 'POST', body: '{}' })
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ignored: true })

    const skippedEvent = (
      mockCreatePluginEvent.mock.calls as Array<[Record<string, unknown>]>
    ).find(([input]) => input.kind === 'webhook_ingress' && input.status === 'skipped')?.[0]
    expect(skippedEvent).toBeDefined()
    const detail = JSON.parse(skippedEvent!.detail_json as string) as Record<string, unknown>
    expect(detail.reasonCode).toBe('inbound_policy_filtered')
  })

  it('keeps queue message text equal to payload body for Slack bot mentions', async () => {
    mockParseWebhook.mockResolvedValue({
      shouldProcess: true,
      workItem: {
        session_key: 'slack:C1:1700000.300',
        source: 'slack',
        source_ref: 'slack:C1:1700000.300',
        title: 'Bot mention',
        payload: JSON.stringify({
          body: '@nitejardev pixel are you there?',
          source: 'slack',
          slackBotMentioned: true,
          slackBotHandle: 'nitejardev',
        }),
        status: 'NEW',
      },
    })

    const result = await routeWebhook(
      'slack',
      'plugin-instance-1',
      new Request('http://example.com', { method: 'POST', body: '{}' })
    )

    expect(result.status).toBe(201)
    expect(result.messageText).toBe('@nitejardev pixel are you there?')
  })
})
