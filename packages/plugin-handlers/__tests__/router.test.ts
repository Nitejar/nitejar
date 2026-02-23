import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest'
import type { PluginHandler } from '../src/types'
import { routeWebhook, getPluginInstanceWithConfig } from '../src/router'
import { pluginHandlerRegistry } from '../src/registry'
import {
  findPluginInstanceById,
  createWorkItem,
  findIdempotencyKey,
  createIdempotencyKey,
  decryptConfig,
  type PluginInstanceRecord,
  type IdempotencyKey,
  type WorkItem,
} from '@nitejar/database'

vi.mock('@nitejar/database', () => ({
  findPluginInstanceById: vi.fn(),
  createWorkItem: vi.fn(),
  findIdempotencyKey: vi.fn(),
  createIdempotencyKey: vi.fn(),
  decryptConfig: vi.fn((config: Record<string, unknown>) => config),
}))

const findPluginInstanceByIdMock = vi.mocked(findPluginInstanceById)
const createWorkItemMock = vi.mocked(createWorkItem)
const findIdempotencyKeyMock = vi.mocked(findIdempotencyKey)
const createIdempotencyKeyMock = vi.mocked(createIdempotencyKey)
const decryptConfigMock = vi.mocked(decryptConfig)

const handlerType = 'test-integration'
const parseWebhook = vi.fn() as MockedFunction<PluginHandler['parseWebhook']>

const handler: PluginHandler = {
  type: handlerType,
  displayName: 'Test Integration',
  sensitiveFields: ['secret'],
  validateConfig: () => ({ valid: true }),
  parseWebhook,
  postResponse: () => Promise.resolve({ success: true }),
}

function registerHandler(): void {
  if (!pluginHandlerRegistry.has(handlerType)) {
    pluginHandlerRegistry.register(handler)
  }
}

function createPluginInstance(overrides: Partial<PluginInstanceRecord> = {}): PluginInstanceRecord {
  return {
    id: 'integration-1',
    type: handlerType,
    name: 'Test',
    config: null,
    scope: 'global',
    enabled: 1,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  } satisfies PluginInstanceRecord
}

beforeEach(() => {
  registerHandler()
  parseWebhook.mockReset()
  findPluginInstanceByIdMock.mockReset()
  createWorkItemMock.mockReset()
  findIdempotencyKeyMock.mockReset()
  createIdempotencyKeyMock.mockReset()
  decryptConfigMock.mockReset()
})

describe('routeWebhook', () => {
  it('returns 404 when plugin instance is missing', async () => {
    findPluginInstanceByIdMock.mockResolvedValue(null)

    const result = await routeWebhook(handlerType, 'missing', new Request('http://example.com'))

    expect(result.status).toBe(404)
    expect(result.body).toEqual({ error: 'Plugin instance not found' })
  })

  it('decrypts config before parsing the webhook', async () => {
    const pluginInstance = createPluginInstance({
      config: JSON.stringify({ secret: 'enc:abc' }),
    })
    findPluginInstanceByIdMock.mockResolvedValue(pluginInstance)
    decryptConfigMock.mockReturnValue({ secret: 'plain' })
    parseWebhook.mockResolvedValue({ shouldProcess: false })

    await routeWebhook(handlerType, pluginInstance.id, new Request('http://example.com'))

    expect(decryptConfigMock).toHaveBeenCalledWith({ secret: 'enc:abc' }, ['secret'])
    expect(parseWebhook).toHaveBeenCalledTimes(1)
    const parsedIntegration = parseWebhook.mock.calls[0]?.[1]
    expect(parsedIntegration?.config).toBe(JSON.stringify({ secret: 'plain' }))
  })

  it('returns duplicate response when idempotency key exists', async () => {
    const pluginInstance = createPluginInstance()
    findPluginInstanceByIdMock.mockResolvedValue(pluginInstance)
    parseWebhook.mockResolvedValue({
      shouldProcess: true,
      idempotencyKey: 'dup-key',
      workItem: {
        session_key: 's',
        source: 'github',
        source_ref: 'ref',
        title: 'Title',
        payload: null,
      },
    })
    const existingKey: IdempotencyKey = {
      key: 'dup-key',
      work_item_id: 'existing',
      created_at: Date.now(),
    }
    findIdempotencyKeyMock.mockResolvedValue(existingKey)

    const result = await routeWebhook(
      handlerType,
      pluginInstance.id,
      new Request('http://example.com')
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ duplicate: true, workItemId: 'existing' })
  })

  it('creates work item and records idempotency key', async () => {
    const pluginInstance = createPluginInstance()
    findPluginInstanceByIdMock.mockResolvedValue(pluginInstance)
    parseWebhook.mockResolvedValue({
      shouldProcess: true,
      idempotencyKey: 'unique-key',
      responseContext: { channel: 'c1' },
      workItem: {
        session_key: 'session',
        source: 'github',
        source_ref: 'ref',
        title: 'Title',
        payload: JSON.stringify({ foo: 'bar' }),
      },
    })
    findIdempotencyKeyMock.mockResolvedValue(null)
    const workItem: WorkItem = {
      id: 'work-1',
      plugin_instance_id: pluginInstance.id,
      session_key: 'session',
      source: 'github',
      source_ref: 'ref',
      status: 'NEW',
      title: 'Title',
      payload: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    }
    createWorkItemMock.mockResolvedValue(workItem)

    const result = await routeWebhook(
      handlerType,
      pluginInstance.id,
      new Request('http://example.com')
    )

    expect(result.status).toBe(201)
    expect(result.workItemId).toBe('work-1')

    const createdArgs = createWorkItemMock.mock.calls[0]?.[0]
    expect(createdArgs?.plugin_instance_id).toBe(pluginInstance.id)
    const payload = JSON.parse(createdArgs?.payload ?? '{}') as Record<string, unknown>
    expect(payload.responseContext).toEqual({ channel: 'c1' })

    expect(createIdempotencyKeyMock).toHaveBeenCalledWith({
      key: 'unique-key',
      work_item_id: 'work-1',
    })
  })

  it('returns handler-provided immediate webhook response while still creating a work item', async () => {
    const pluginInstance = createPluginInstance()
    findPluginInstanceByIdMock.mockResolvedValue(pluginInstance)
    parseWebhook.mockResolvedValue({
      shouldProcess: true,
      webhookResponse: {
        status: 200,
        body: { type: 5 },
      },
      workItem: {
        session_key: 'session',
        source: 'discord',
        source_ref: 'discord:g:c:i',
        title: 'Title',
        payload: JSON.stringify({ body: 'hello' }),
      },
    })
    findIdempotencyKeyMock.mockResolvedValue(null)
    createWorkItemMock.mockResolvedValue({
      id: 'work-immediate-1',
      plugin_instance_id: pluginInstance.id,
      session_key: 'session',
      source: 'discord',
      source_ref: 'discord:g:c:i',
      status: 'NEW',
      title: 'Title',
      payload: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    })

    const result = await routeWebhook(
      handlerType,
      pluginInstance.id,
      new Request('http://example.com')
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ type: 5 })
    expect(result.workItemId).toBe('work-immediate-1')
  })

  it('returns canonical actor envelope when payload includes actor metadata', async () => {
    const pluginInstance = createPluginInstance()
    findPluginInstanceByIdMock.mockResolvedValue(pluginInstance)
    parseWebhook.mockResolvedValue({
      shouldProcess: true,
      responseContext: { channel: 'c1' },
      workItem: {
        session_key: 'session',
        source: 'github',
        source_ref: 'ref',
        title: 'Title',
        payload: JSON.stringify({
          body: 'hello',
          senderName: 'alice',
          actor: {
            kind: 'agent',
            agentId: 'agent-123',
            handle: 'slopper',
            displayName: 'Slopper',
            source: 'github',
          },
        }),
      },
    })
    createWorkItemMock.mockResolvedValue({
      id: 'work-actor-1',
      plugin_instance_id: pluginInstance.id,
      session_key: 'session',
      source: 'github',
      source_ref: 'ref',
      status: 'NEW',
      title: 'Title',
      payload: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    })

    const result = await routeWebhook(
      handlerType,
      pluginInstance.id,
      new Request('http://example.com')
    )

    expect(result.actor).toEqual({
      kind: 'agent',
      agentId: 'agent-123',
      handle: 'slopper',
      displayName: 'Slopper',
      source: 'github',
      externalId: undefined,
    })
  })

  it('derives fallback human actor envelope from sender fields when actor is absent', async () => {
    const pluginInstance = createPluginInstance()
    findPluginInstanceByIdMock.mockResolvedValue(pluginInstance)
    parseWebhook.mockResolvedValue({
      shouldProcess: true,
      workItem: {
        session_key: 'session',
        source: 'telegram',
        source_ref: 'ref',
        title: 'Title',
        payload: JSON.stringify({
          body: 'hello',
          source: 'telegram',
          senderName: 'Alice',
          senderUsername: 'alice',
          senderId: 42,
        }),
      },
    })
    createWorkItemMock.mockResolvedValue({
      id: 'work-actor-2',
      plugin_instance_id: pluginInstance.id,
      session_key: 'session',
      source: 'telegram',
      source_ref: 'ref',
      status: 'NEW',
      title: 'Title',
      payload: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    })

    const result = await routeWebhook(
      handlerType,
      pluginInstance.id,
      new Request('http://example.com')
    )

    expect(result.actor).toEqual({
      kind: 'human',
      externalId: '42',
      handle: 'alice',
      displayName: 'Alice',
      source: 'telegram',
      agentId: undefined,
    })
  })
})

describe('getPluginInstanceWithConfig', () => {
  it('returns decrypted config when handler exists', async () => {
    const pluginInstance = createPluginInstance({
      config: JSON.stringify({ secret: 'enc:abc' }),
    })
    findPluginInstanceByIdMock.mockResolvedValue(pluginInstance)
    decryptConfigMock.mockReturnValue({ secret: 'plain' })

    const result = await getPluginInstanceWithConfig(pluginInstance.id)

    expect(result?.config).toBe(JSON.stringify({ secret: 'plain' }))
  })
})
