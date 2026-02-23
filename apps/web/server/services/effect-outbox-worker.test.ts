import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetRuntimeControl,
  mockClaimNextEffectOutbox,
  mockMarkEffectOutboxSent,
  mockMarkEffectOutboxFailed,
  mockMarkEffectOutboxUnknown,
  mockCreateWorkItem,
  mockFindWorkItemById,
  mockGetAgentsForPluginInstance,
  mockCreateQueueMessage,
  mockUpsertQueueLaneOnMessage,
  mockGetDb,
  mockDbFindRelayWorkItem,
  mockGetPluginInstanceWithConfig,
  mockPluginHandlerGet,
  mockParseAgentConfig,
  mockDispatchHook,
} = vi.hoisted(() => {
  const getRuntimeControl = vi.fn()
  const claimNextEffectOutbox = vi.fn()
  const markEffectOutboxSent = vi.fn()
  const markEffectOutboxFailed = vi.fn()
  const markEffectOutboxUnknown = vi.fn()
  const createWorkItem = vi.fn()
  const findWorkItemById = vi.fn()
  const getAgentsForPluginInstance = vi.fn()
  const createQueueMessage = vi.fn()
  const upsertQueueLaneOnMessage = vi.fn()
  const dbFindRelayWorkItem = vi.fn()
  const getDb = vi.fn(() => ({
    selectFrom: vi.fn(() => ({
      select: vi.fn(() => ({
        where: vi.fn(() => ({
          executeTakeFirst: dbFindRelayWorkItem,
        })),
      })),
    })),
  }))

  const getPluginInstanceWithConfig = vi.fn()
  const pluginHandlerGet = vi.fn()
  const parseAgentConfig = vi.fn(() => ({}))
  const dispatchHook = vi.fn()

  return {
    mockGetRuntimeControl: getRuntimeControl,
    mockClaimNextEffectOutbox: claimNextEffectOutbox,
    mockMarkEffectOutboxSent: markEffectOutboxSent,
    mockMarkEffectOutboxFailed: markEffectOutboxFailed,
    mockMarkEffectOutboxUnknown: markEffectOutboxUnknown,
    mockCreateWorkItem: createWorkItem,
    mockFindWorkItemById: findWorkItemById,
    mockGetAgentsForPluginInstance: getAgentsForPluginInstance,
    mockCreateQueueMessage: createQueueMessage,
    mockUpsertQueueLaneOnMessage: upsertQueueLaneOnMessage,
    mockGetDb: getDb,
    mockDbFindRelayWorkItem: dbFindRelayWorkItem,
    mockGetPluginInstanceWithConfig: getPluginInstanceWithConfig,
    mockPluginHandlerGet: pluginHandlerGet,
    mockParseAgentConfig: parseAgentConfig,
    mockDispatchHook: dispatchHook,
  }
})

vi.mock('@nitejar/database', () => ({
  getRuntimeControl: mockGetRuntimeControl,
  claimNextEffectOutbox: mockClaimNextEffectOutbox,
  markEffectOutboxSent: mockMarkEffectOutboxSent,
  markEffectOutboxFailed: mockMarkEffectOutboxFailed,
  markEffectOutboxUnknown: mockMarkEffectOutboxUnknown,
  createWorkItem: mockCreateWorkItem,
  findWorkItemById: mockFindWorkItemById,
  getAgentsForPluginInstance: mockGetAgentsForPluginInstance,
  createQueueMessage: mockCreateQueueMessage,
  upsertQueueLaneOnMessage: mockUpsertQueueLaneOnMessage,
  getDb: mockGetDb,
}))

vi.mock('@nitejar/plugin-handlers', () => ({
  getPluginInstanceWithConfig: mockGetPluginInstanceWithConfig,
  pluginHandlerRegistry: {
    get: mockPluginHandlerGet,
  },
  DEFAULT_QUEUE_CONFIG: {
    mode: 'steer',
    debounceMs: 2000,
    maxQueued: 10,
  },
}))

vi.mock('@nitejar/agent/config', () => ({
  parseAgentConfig: mockParseAgentConfig,
}))

vi.mock('./routines/publish', () => ({
  publishRoutineEnvelopeFromWorkItem: vi.fn(() => Promise.resolve()),
}))

vi.mock('./plugins/hook-dispatch', () => ({
  dispatchHook: mockDispatchHook,
}))

import { __effectOutboxTest } from './effect-outbox-worker'

const mockPostResponse = vi.fn()

function buildEffect(
  overrides: Partial<{
    id: string
    plugin_instance_id: string
    work_item_id: string
    job_id: string
    payload: string
    attempt_count: number
    claimed_epoch: number
  }> = {}
) {
  return {
    id: 'effect-1',
    plugin_instance_id: 'int-1',
    work_item_id: 'wi-1',
    job_id: 'job-1',
    payload: JSON.stringify({
      content: 'Hello from the agent!',
      responseContext: { chatId: 123 },
    }),
    attempt_count: 0,
    claimed_epoch: 1,
    ...overrides,
  }
}

function buildRelayPayload(
  overrides: Partial<{
    content: string
    responseContext: { chatId: number; messageId: number; messageThreadId: number }
    actor: {
      kind: string
      agentId?: string
      handle?: string
      displayName?: string
      source?: string
    }
  }> = {}
) {
  return {
    content: '@pixel your turn to continue counting',
    responseContext: {
      chatId: 123,
      messageId: 456,
      messageThreadId: 789,
    },
    actor: {
      kind: 'agent',
      agentId: 'agent-slopper',
      handle: 'nitejar-dev',
      displayName: 'Slopper',
      source: 'telegram',
    },
    ...overrides,
  }
}

function buildSourceWorkItem(
  overrides: Partial<{
    id: string
    plugin_instance_id: string | null
    session_key: string | null
    payload: string
  }> = {}
) {
  return {
    id: 'wi-source',
    plugin_instance_id: 'int-1',
    session_key: 'telegram:123:thread:789',
    source: 'telegram',
    source_ref: 'telegram:123:789:456',
    status: 'DONE',
    title: 'source',
    payload: JSON.stringify({ relayDepth: 0 }),
    created_at: 1,
    updated_at: 1,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  mockGetRuntimeControl.mockResolvedValue({ processing_enabled: 1 })
  mockClaimNextEffectOutbox.mockResolvedValue(buildEffect())
  mockGetPluginInstanceWithConfig.mockResolvedValue({
    id: 'int-1',
    type: 'test-plugin',
    config: null,
  })
  mockPluginHandlerGet.mockReturnValue({
    postResponse: mockPostResponse,
  })
  mockPostResponse.mockResolvedValue({ success: true, outcome: 'sent' })
  mockDispatchHook.mockResolvedValue({ blocked: false, data: {}, receipts: [] })

  mockMarkEffectOutboxSent.mockResolvedValue(null)
  mockMarkEffectOutboxFailed.mockResolvedValue(null)
  mockMarkEffectOutboxUnknown.mockResolvedValue(null)

  mockFindWorkItemById.mockResolvedValue(null)
  mockDbFindRelayWorkItem.mockResolvedValue(undefined)
  mockGetAgentsForPluginInstance.mockResolvedValue([])
  mockCreateWorkItem.mockResolvedValue({
    id: 'wi-relay',
    plugin_instance_id: 'int-1',
    session_key: 'telegram:123:thread:789',
    source: 'telegram',
    source_ref: 'agent_relay:effect-1',
    status: 'NEW',
    title: 'relay',
    payload: '{}',
    created_at: 1,
    updated_at: 1,
  })
  mockCreateQueueMessage.mockResolvedValue(null)
  mockUpsertQueueLaneOnMessage.mockResolvedValue(null)
})

describe('effect outbox worker processing control gate', () => {
  it('does nothing when processing_enabled is 0', async () => {
    mockGetRuntimeControl.mockResolvedValueOnce({ processing_enabled: 0 })

    await __effectOutboxTest.processNextEffect()

    expect(mockClaimNextEffectOutbox).not.toHaveBeenCalled()
  })

  it('does nothing when processing_enabled is not 1', async () => {
    mockGetRuntimeControl.mockResolvedValueOnce({ processing_enabled: 2 })

    await __effectOutboxTest.processNextEffect()

    expect(mockClaimNextEffectOutbox).not.toHaveBeenCalled()
  })

  it('proceeds when processing_enabled is 1', async () => {
    mockClaimNextEffectOutbox.mockResolvedValueOnce(null)

    await __effectOutboxTest.processNextEffect()

    expect(mockClaimNextEffectOutbox).toHaveBeenCalledWith(
      expect.stringContaining('effect-worker:'),
      { leaseSeconds: 120 }
    )
  })
})

describe('effect outbox worker claiming and basic delivery', () => {
  it('does nothing when no effect is available to claim', async () => {
    mockClaimNextEffectOutbox.mockResolvedValueOnce(null)

    await __effectOutboxTest.processNextEffect()

    expect(mockGetPluginInstanceWithConfig).not.toHaveBeenCalled()
    expect(mockMarkEffectOutboxSent).not.toHaveBeenCalled()
    expect(mockMarkEffectOutboxFailed).not.toHaveBeenCalled()
    expect(mockMarkEffectOutboxUnknown).not.toHaveBeenCalled()
  })

  it('calls postResponse handler with content, responseContext, and options from payload', async () => {
    const effect = buildEffect({
      work_item_id: 'wi-ctx',
      payload: JSON.stringify({
        content: 'Ship it',
        responseContext: { chatId: 77, messageId: 88 },
        options: { hitLimit: true, idempotencyKey: 'idemp-123' },
      }),
    })
    const pluginInstance = { id: 'int-1', type: 'test-plugin', config: null }

    mockClaimNextEffectOutbox.mockResolvedValueOnce(effect)
    mockGetPluginInstanceWithConfig.mockResolvedValueOnce(pluginInstance)

    await __effectOutboxTest.processNextEffect()

    expect(mockPostResponse).toHaveBeenCalledWith(
      pluginInstance,
      'wi-ctx',
      'Ship it',
      { chatId: 77, messageId: 88 },
      { hitLimit: true, idempotencyKey: 'idemp-123' }
    )
  })

  it('marks effect as sent with providerRef when handler returns success+sent', async () => {
    mockPostResponse.mockResolvedValueOnce({
      success: true,
      outcome: 'sent',
      providerRef: 'provider-ref-1',
    })

    await __effectOutboxTest.processNextEffect()

    expect(mockMarkEffectOutboxSent).toHaveBeenCalledWith('effect-1', 'provider-ref-1', {
      expectedEpoch: 1,
    })
  })

  it('passes expectedEpoch to markEffectOutboxSent for optimistic concurrency', async () => {
    mockClaimNextEffectOutbox.mockResolvedValueOnce(
      buildEffect({
        id: 'effect-epoch',
        claimed_epoch: 99,
      })
    )

    await __effectOutboxTest.processNextEffect()

    expect(mockMarkEffectOutboxSent).toHaveBeenCalledWith('effect-epoch', undefined, {
      expectedEpoch: 99,
    })
  })
})

describe('effect outbox worker missing plugin/handler', () => {
  it('marks failed (non-retryable) when plugin instance not found', async () => {
    mockGetPluginInstanceWithConfig.mockResolvedValueOnce(null)

    await __effectOutboxTest.processNextEffect()

    expect(mockMarkEffectOutboxFailed).toHaveBeenCalledWith(
      'effect-1',
      'Plugin instance not found',
      {
        retryable: false,
        expectedEpoch: 1,
      }
    )
  })

  it('marks failed (non-retryable) when plugin handler has no postResponse method', async () => {
    mockPluginHandlerGet.mockReturnValueOnce({})

    await __effectOutboxTest.processNextEffect()

    expect(mockMarkEffectOutboxFailed).toHaveBeenCalledWith(
      'effect-1',
      'No postResponse handler for test-plugin',
      {
        retryable: false,
        expectedEpoch: 1,
      }
    )
  })

  it.each([
    { label: 'missing content', payload: {} },
    { label: 'empty content', payload: { content: '' } },
  ])('marks failed (non-retryable) when payload content is $label', async ({ payload }) => {
    mockClaimNextEffectOutbox.mockResolvedValueOnce(
      buildEffect({
        payload: JSON.stringify(payload),
      })
    )

    await __effectOutboxTest.processNextEffect()

    expect(mockMarkEffectOutboxFailed).toHaveBeenCalledWith('effect-1', 'Missing content payload', {
      retryable: false,
      expectedEpoch: 1,
    })
  })
})

describe('effect outbox worker hook dispatch response.pre_deliver', () => {
  it('calls dispatchHook(response.pre_deliver, ...) before sending', async () => {
    await __effectOutboxTest.processNextEffect()

    expect(mockDispatchHook).toHaveBeenCalled()
    expect(mockDispatchHook.mock.calls[0]?.[0]).toBe('response.pre_deliver')
    expect(mockPostResponse).toHaveBeenCalled()
  })

  it('blocks delivery and marks failed when hook returns { blocked: true }', async () => {
    mockDispatchHook.mockResolvedValueOnce({ blocked: true, data: {}, receipts: [] })

    await __effectOutboxTest.processNextEffect()

    expect(mockPostResponse).not.toHaveBeenCalled()
    expect(mockMarkEffectOutboxFailed).toHaveBeenCalledWith(
      'effect-1',
      'Delivery blocked by plugin hook',
      {
        retryable: false,
        expectedEpoch: 1,
      }
    )
  })

  it('transforms content when hook returns updated content string', async () => {
    mockDispatchHook.mockResolvedValueOnce({
      blocked: false,
      data: { content: 'Transformed content' },
      receipts: [],
    })

    await __effectOutboxTest.processNextEffect()

    expect(mockPostResponse).toHaveBeenCalledWith(
      expect.anything(),
      'wi-1',
      'Transformed content',
      { chatId: 123 },
      undefined
    )
  })

  it('uses original content when hook returns no content override', async () => {
    mockDispatchHook.mockResolvedValueOnce({
      blocked: false,
      data: {},
      receipts: [],
    })

    await __effectOutboxTest.processNextEffect()

    expect(mockPostResponse).toHaveBeenCalledWith(
      expect.anything(),
      'wi-1',
      'Hello from the agent!',
      { chatId: 123 },
      undefined
    )
  })

  it('proceeds normally when hook throws (non-fatal)', async () => {
    mockDispatchHook.mockRejectedValueOnce(new Error('pre_deliver hook exploded'))

    await __effectOutboxTest.processNextEffect()

    expect(mockPostResponse).toHaveBeenCalled()
    expect(mockMarkEffectOutboxSent).toHaveBeenCalledWith('effect-1', undefined, {
      expectedEpoch: 1,
    })
  })
})

describe('effect outbox worker hook dispatch response.post_deliver', () => {
  it('calls dispatchHook(response.post_deliver, ...) after successful send', async () => {
    await __effectOutboxTest.processNextEffect()

    expect(mockDispatchHook.mock.calls[0]?.[0]).toBe('response.pre_deliver')
    expect(mockDispatchHook.mock.calls[1]?.[0]).toBe('response.post_deliver')
    expect(mockDispatchHook.mock.calls[1]?.[2]).toMatchObject({
      content: 'Hello from the agent!',
      result: { success: true, outcome: 'sent' },
    })
  })

  it('proceeds normally when post_deliver hook throws (non-fatal)', async () => {
    mockDispatchHook
      .mockResolvedValueOnce({ blocked: false, data: {}, receipts: [] })
      .mockRejectedValueOnce(new Error('post_deliver hook exploded'))

    await __effectOutboxTest.processNextEffect()

    expect(mockMarkEffectOutboxSent).toHaveBeenCalledWith('effect-1', undefined, {
      expectedEpoch: 1,
    })
  })
})

describe('effect outbox worker outcome handling', () => {
  it("marks sent for outcome 'sent' (explicit)", async () => {
    mockPostResponse.mockResolvedValueOnce({
      success: true,
      outcome: 'sent',
      providerRef: 'explicit-ref',
    })

    await __effectOutboxTest.processNextEffect()

    expect(mockMarkEffectOutboxSent).toHaveBeenCalledWith('effect-1', 'explicit-ref', {
      expectedEpoch: 1,
    })
  })

  it('marks sent when outcome is undefined but success is true', async () => {
    mockPostResponse.mockResolvedValueOnce({
      success: true,
      providerRef: 'implicit-ref',
    })

    await __effectOutboxTest.processNextEffect()

    expect(mockMarkEffectOutboxSent).toHaveBeenCalledWith('effect-1', 'implicit-ref', {
      expectedEpoch: 1,
    })
  })

  it("marks unknown for outcome 'unknown'", async () => {
    mockPostResponse.mockResolvedValueOnce({
      success: false,
      outcome: 'unknown',
      error: 'Provider returned unknown',
    })

    await __effectOutboxTest.processNextEffect()

    expect(mockMarkEffectOutboxUnknown).toHaveBeenCalledWith(
      'effect-1',
      'Provider returned unknown',
      {
        expectedEpoch: 1,
      }
    )
  })

  it('marks failed (retryable) when result.retryable is true', async () => {
    mockPostResponse.mockResolvedValueOnce({
      success: false,
      outcome: 'failed',
      retryable: true,
      error: 'Temporary error',
    })

    await __effectOutboxTest.processNextEffect()

    expect(mockMarkEffectOutboxFailed).toHaveBeenCalledTimes(1)
    const failedCall = mockMarkEffectOutboxFailed.mock.calls[0]
    expect(failedCall?.[0]).toBe('effect-1')
    expect(failedCall?.[1]).toBe('Temporary error')
    const opts = failedCall?.[2] as {
      retryable: boolean
      nextAttemptAt: number | null
      expectedEpoch: number
    }
    expect(opts.retryable).toBe(true)
    expect(typeof opts.nextAttemptAt).toBe('number')
    expect(opts.expectedEpoch).toBe(1)
  })

  it('marks failed (non-retryable) when result.retryable is false', async () => {
    mockPostResponse.mockResolvedValueOnce({
      success: false,
      outcome: 'failed',
      retryable: false,
      error: 'Permanent error',
    })

    await __effectOutboxTest.processNextEffect()

    expect(mockMarkEffectOutboxFailed).toHaveBeenCalledWith('effect-1', 'Permanent error', {
      retryable: false,
      nextAttemptAt: null,
      expectedEpoch: 1,
    })
  })

  it('marks failed (non-retryable) when result.retryable is undefined', async () => {
    mockPostResponse.mockResolvedValueOnce({
      success: false,
      outcome: 'failed',
      error: 'Unknown error',
    })

    await __effectOutboxTest.processNextEffect()

    expect(mockMarkEffectOutboxFailed).toHaveBeenCalledWith('effect-1', 'Unknown error', {
      retryable: false,
      nextAttemptAt: null,
      expectedEpoch: 1,
    })
  })

  it('marks unknown on transport-level exception (catch block)', async () => {
    mockPostResponse.mockRejectedValueOnce(new Error('Socket hang up'))

    await __effectOutboxTest.processNextEffect()

    expect(mockMarkEffectOutboxUnknown).toHaveBeenCalledWith('effect-1', 'Socket hang up', {
      expectedEpoch: 1,
    })
  })
})

describe('effect outbox worker retry delay calculation', () => {
  it.each([
    { attempt: 0, expected: 5 },
    { attempt: 1, expected: 10 },
    { attempt: 2, expected: 20 },
    { attempt: 5, expected: 50 },
    { attempt: 30, expected: 300 },
    { attempt: 100, expected: 300 },
  ])('attempt $attempt -> $expected seconds', ({ attempt, expected }) => {
    expect(__effectOutboxTest.retryDelaySeconds(attempt)).toBe(expected)
  })

  it('passes computed nextAttemptAt using attempt_count + 1 when retryable', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    mockClaimNextEffectOutbox.mockResolvedValueOnce(
      buildEffect({
        id: 'effect-retry',
        attempt_count: 4,
        claimed_epoch: 7,
      })
    )
    mockPostResponse.mockResolvedValueOnce({
      success: false,
      outcome: 'failed',
      retryable: true,
      error: 'Retry me',
    })

    await __effectOutboxTest.processNextEffect()

    expect(mockMarkEffectOutboxFailed).toHaveBeenCalledWith('effect-retry', 'Retry me', {
      retryable: true,
      nextAttemptAt: 1_700_000_000 + __effectOutboxTest.retryDelaySeconds(5),
      expectedEpoch: 7,
    })

    nowSpy.mockRestore()
  })
})

describe('effect outbox worker relay', () => {
  beforeEach(() => {
    mockDbFindRelayWorkItem.mockResolvedValue(undefined)

    mockClaimNextEffectOutbox.mockResolvedValue(
      buildEffect({
        id: 'effect-1',
        work_item_id: 'wi-source',
        claimed_epoch: 5,
        payload: JSON.stringify(buildRelayPayload()),
      })
    )

    mockGetPluginInstanceWithConfig.mockResolvedValue({
      id: 'int-1',
      type: 'telegram',
      config: null,
    })

    mockFindWorkItemById.mockResolvedValue(buildSourceWorkItem())

    mockGetAgentsForPluginInstance.mockResolvedValue([
      {
        id: 'agent-slopper',
        handle: 'nitejar-dev',
        name: 'Slopper',
        sprite_id: null,
        config: null,
        status: 'idle',
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 'agent-pixel',
        handle: 'pixel',
        name: 'Pixel',
        sprite_id: null,
        config: null,
        status: 'idle',
        created_at: 1,
        updated_at: 1,
      },
    ])
  })

  it('enqueues a relay work item for non-origin agents after telegram send', async () => {
    await __effectOutboxTest.processNextEffect()

    expect(mockCreateWorkItem).toHaveBeenCalledTimes(1)
    expect(mockCreateQueueMessage).toHaveBeenCalledTimes(1)

    const queueCall = mockCreateQueueMessage.mock.calls[0]?.[0] as { queue_key: string }
    expect(queueCall.queue_key).toContain(':agent-pixel')
    expect(queueCall.queue_key).not.toContain(':agent-slopper')

    expect(mockMarkEffectOutboxSent).toHaveBeenCalledWith('effect-1', undefined, {
      expectedEpoch: 5,
    })
  })

  it('applies queue staggering across relay target agents', async () => {
    mockClaimNextEffectOutbox.mockResolvedValue({
      ...buildEffect({
        id: 'effect-2',
        work_item_id: 'wi-source',
        claimed_epoch: 6,
      }),
      payload: JSON.stringify(
        buildRelayPayload({
          content: '@team continue',
          actor: {
            kind: 'agent',
            agentId: 'agent-not-assigned',
            handle: 'external-agent',
            displayName: 'External Agent',
            source: 'telegram',
          },
        })
      ),
    })

    mockGetAgentsForPluginInstance.mockResolvedValue([
      {
        id: 'agent-slopper',
        handle: 'nitejar-dev',
        name: 'Slopper',
        sprite_id: null,
        config: null,
        status: 'idle',
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 'agent-pixel',
        handle: 'pixel',
        name: 'Pixel',
        sprite_id: null,
        config: null,
        status: 'idle',
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 'agent-rivet',
        handle: 'rivet',
        name: 'Rivet',
        sprite_id: null,
        config: null,
        status: 'idle',
        created_at: 1,
        updated_at: 1,
      },
    ])

    await __effectOutboxTest.processNextEffect()

    expect(mockCreateQueueMessage).toHaveBeenCalledTimes(3)
    expect(mockUpsertQueueLaneOnMessage).toHaveBeenCalledTimes(3)

    const debounceValues = mockUpsertQueueLaneOnMessage.mock.calls
      .map(([input]) => (input as { debounceMs: number }).debounceMs)
      .sort((a, b) => a - b)

    expect(debounceValues).toEqual([2000, 7000, 12000])
    expect(mockMarkEffectOutboxSent).toHaveBeenCalledWith('effect-2', undefined, {
      expectedEpoch: 6,
    })
  })

  it('does not relay when content is empty/whitespace', async () => {
    mockClaimNextEffectOutbox.mockResolvedValueOnce(
      buildEffect({
        work_item_id: 'wi-source',
        payload: JSON.stringify(buildRelayPayload({ content: '   ' })),
      })
    )

    await __effectOutboxTest.processNextEffect()

    expect(mockCreateWorkItem).not.toHaveBeenCalled()
  })

  it("does not relay when actor is not kind 'agent'", async () => {
    mockClaimNextEffectOutbox.mockResolvedValueOnce(
      buildEffect({
        work_item_id: 'wi-source',
        payload: JSON.stringify(buildRelayPayload({ actor: { kind: 'user' } })),
      })
    )

    await __effectOutboxTest.processNextEffect()

    expect(mockCreateWorkItem).not.toHaveBeenCalled()
  })

  it('does not relay when actor is undefined', async () => {
    const relayPayload = buildRelayPayload()
    const payloadWithoutActor = {
      content: relayPayload.content,
      responseContext: relayPayload.responseContext,
    }

    mockClaimNextEffectOutbox.mockResolvedValueOnce(
      buildEffect({
        work_item_id: 'wi-source',
        payload: JSON.stringify(payloadWithoutActor),
      })
    )

    await __effectOutboxTest.processNextEffect()

    expect(mockCreateWorkItem).not.toHaveBeenCalled()
  })

  it('does not relay when source work item has no plugin_instance_id', async () => {
    mockFindWorkItemById.mockResolvedValueOnce(
      buildSourceWorkItem({
        plugin_instance_id: null,
      })
    )

    await __effectOutboxTest.processNextEffect()

    expect(mockCreateWorkItem).not.toHaveBeenCalled()
  })

  it('does not relay when source work item has no session_key', async () => {
    mockFindWorkItemById.mockResolvedValueOnce(
      buildSourceWorkItem({
        session_key: null,
      })
    )

    await __effectOutboxTest.processNextEffect()

    expect(mockCreateWorkItem).not.toHaveBeenCalled()
  })

  it('does not relay when relay depth >= MAX_AGENT_PUBLIC_RELAY_DEPTH (12)', async () => {
    mockFindWorkItemById.mockResolvedValueOnce(
      buildSourceWorkItem({
        payload: JSON.stringify({ relayDepth: 12 }),
      })
    )

    await __effectOutboxTest.processNextEffect()

    expect(mockCreateWorkItem).not.toHaveBeenCalled()
  })

  it('does not relay when a relay work item already exists (dedup check)', async () => {
    mockDbFindRelayWorkItem.mockResolvedValueOnce({ id: 'wi-relay-existing' })

    await __effectOutboxTest.processNextEffect()

    expect(mockCreateWorkItem).not.toHaveBeenCalled()
  })

  it('does not relay when no agents are registered for the plugin instance', async () => {
    mockGetAgentsForPluginInstance.mockResolvedValueOnce([])

    await __effectOutboxTest.processNextEffect()

    expect(mockCreateWorkItem).not.toHaveBeenCalled()
  })

  it('does not relay when only the origin agent is registered (no target agents)', async () => {
    mockGetAgentsForPluginInstance.mockResolvedValueOnce([
      {
        id: 'agent-slopper',
        handle: 'nitejar-dev',
        name: 'Slopper',
        sprite_id: null,
        config: null,
        status: 'idle',
        created_at: 1,
        updated_at: 1,
      },
    ])

    await __effectOutboxTest.processNextEffect()

    expect(mockCreateWorkItem).not.toHaveBeenCalled()
  })

  it('increments relayDepth in the relay work item payload', async () => {
    mockFindWorkItemById.mockResolvedValueOnce(
      buildSourceWorkItem({
        payload: JSON.stringify({ relayDepth: 3 }),
      })
    )

    await __effectOutboxTest.processNextEffect()

    expect(mockCreateWorkItem).toHaveBeenCalledTimes(1)
    const createWorkItemInput = mockCreateWorkItem.mock.calls[0]?.[0] as { payload: string }
    const relayPayload = JSON.parse(createWorkItemInput.payload) as { relayDepth: number }
    expect(relayPayload.relayDepth).toBe(4)
  })
})
