import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRouteWebhook,
  mockGetPluginInstanceWithConfig,
  mockPluginHandlerGet,
  mockEnsureRuntimeWorkers,
  mockGetAgentsForPluginInstance,
  mockCreateQueueMessage,
  mockUpsertQueueLaneOnMessage,
  mockUpdateWorkItem,
  mockGetRuntimeControl,
  mockRunAgent,
  mockParseAgentConfig,
  routeResults,
  postedMessages,
  runCalls,
} = vi.hoisted(() => {
  const routeWebhook = vi.fn()
  const getPluginInstanceWithConfig = vi.fn()
  const pluginHandlerGet = vi.fn()
  const ensureRuntimeWorkers = vi.fn(() => Promise.resolve(undefined))
  const getAgentsForPluginInstance = vi.fn()
  const createQueueMessage = vi.fn((_input: Record<string, unknown>) => Promise.resolve(null))
  const upsertQueueLaneOnMessage = vi.fn((_input: { debounceMs: number }) => Promise.resolve(null))
  const updateWorkItem = vi.fn(() => Promise.resolve(null))
  const getRuntimeControl = vi.fn(() => Promise.resolve({ processing_enabled: 1 }))
  const parseAgentConfig = vi.fn(() => ({}))

  const queuedRouteResults: Array<Record<string, unknown>> = []
  const sent: Array<{ workItemId: string; content: string }> = []
  const runInvocations: Array<{ agentId: string; workItemId: string; finalResponse: string }> = []

  const runAgent = vi.fn((agentId: string, workItemId: string) => {
    const match = workItemId.match(/(\d+)$/)
    const turn = match ? Number(match[1]) : 0
    const finalResponse = turn >= 10 ? '10 (stop)' : String(turn)
    runInvocations.push({ agentId, workItemId, finalResponse })
    return {
      job: {
        id: `job-${workItemId}`,
      },
      finalResponse,
      hitLimit: false,
    }
  })

  return {
    mockRouteWebhook: routeWebhook,
    mockGetPluginInstanceWithConfig: getPluginInstanceWithConfig,
    mockPluginHandlerGet: pluginHandlerGet,
    mockEnsureRuntimeWorkers: ensureRuntimeWorkers,
    mockGetAgentsForPluginInstance: getAgentsForPluginInstance,
    mockCreateQueueMessage: createQueueMessage,
    mockUpsertQueueLaneOnMessage: upsertQueueLaneOnMessage,
    mockUpdateWorkItem: updateWorkItem,
    mockGetRuntimeControl: getRuntimeControl,
    mockRunAgent: runAgent,
    mockParseAgentConfig: parseAgentConfig,
    routeResults: queuedRouteResults,
    postedMessages: sent,
    runCalls: runInvocations,
  }
})

vi.mock('@nitejar/plugin-handlers', () => ({
  routeWebhook: mockRouteWebhook,
  getPluginInstanceWithConfig: mockGetPluginInstanceWithConfig,
  DEFAULT_QUEUE_CONFIG: {
    mode: 'steer',
    debounceMs: 1000,
    maxQueued: 10,
  },
  pluginHandlerRegistry: {
    get: mockPluginHandlerGet,
    has: vi.fn(() => true),
    register: vi.fn(),
  },
}))

vi.mock('@nitejar/agent/runner', () => ({
  runAgent: mockRunAgent,
}))

vi.mock('@nitejar/agent/mention-parser', () => ({
  extractMentions: vi.fn(() => []),
}))

vi.mock('@nitejar/agent/config', () => ({
  parseAgentConfig: mockParseAgentConfig,
}))

vi.mock('@nitejar/database', () => ({
  getAgentsForPluginInstance: mockGetAgentsForPluginInstance,
  findAgentByHandle: vi.fn(() => Promise.resolve(null)),
  updateWorkItem: mockUpdateWorkItem,
  findWorkItemById: vi.fn(() => Promise.resolve(null)),
  createWorkItem: vi.fn(() => Promise.resolve(null)),
  createJob: vi.fn(() => Promise.resolve(null)),
  startJob: vi.fn(() => Promise.resolve(null)),
  completeJob: vi.fn(() => Promise.resolve(null)),
  appendMessage: vi.fn(() => Promise.resolve(null)),
  createQueueMessage: mockCreateQueueMessage,
  upsertQueueLaneOnMessage: mockUpsertQueueLaneOnMessage,
  getRuntimeControl: mockGetRuntimeControl,
}))

vi.mock('../../../../../../server/services/runtime-workers', () => ({
  ensureRuntimeWorkers: mockEnsureRuntimeWorkers,
}))

import { POST } from './route'

describe('webhook route agent-origin exclusion collaboration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeResults.length = 0
    postedMessages.length = 0
    runCalls.length = 0

    const agents = [
      {
        id: 'agent-slopper',
        handle: 'slopper',
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
    ]

    mockGetAgentsForPluginInstance.mockResolvedValue(agents)

    mockGetPluginInstanceWithConfig.mockResolvedValue({
      id: 'plugin-instance-1',
      type: 'test-chat',
      config: null,
    })

    mockPluginHandlerGet.mockReturnValue({
      responseMode: 'streaming',
      postResponse: (
        _integration: unknown,
        workItemId: string,
        content: string
      ): Promise<{ success: true }> => {
        postedMessages.push({ workItemId, content })
        return Promise.resolve({ success: true })
      },
    })

    mockRouteWebhook.mockImplementation(() => {
      const next = routeResults.shift()
      if (!next) {
        throw new Error('No mock route result queued')
      }
      return next
    })
  })

  it('counts to 10 with alternating agent-origin turns and one run per turn', async () => {
    for (let turn = 1; turn <= 10; turn += 1) {
      const originAgentId = turn % 2 === 1 ? 'agent-slopper' : 'agent-pixel'
      routeResults.push({
        status: 201,
        body: { created: true, workItemId: `wi-${turn}` },
        workItemId: `wi-${turn}`,
        pluginInstanceId: 'plugin-instance-1',
        responseContext: { turn },
        sessionKey: '',
        senderName: 'Agent Relay',
        messageText: `turn-${turn}`,
        actor: {
          kind: 'agent',
          agentId: originAgentId,
          handle: originAgentId === 'agent-slopper' ? 'slopper' : 'pixel',
          source: 'test-chat',
        },
      })

      const req = new Request('http://localhost/api/webhooks/plugins/test-chat/plugin-instance-1', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ turn }),
      })

      const response = await POST(req, {
        params: Promise.resolve({ type: 'test-chat', instanceId: 'plugin-instance-1' }),
      })

      expect(response.status).toBe(201)
    }

    await vi.waitFor(() => {
      expect(runCalls).toHaveLength(10)
      expect(postedMessages).toHaveLength(10)
      expect(mockUpdateWorkItem).toHaveBeenCalledTimes(10)
    })

    for (let turn = 1; turn <= 10; turn += 1) {
      const call = runCalls.find((entry) => entry.workItemId === `wi-${turn}`)
      expect(call).toBeDefined()
      const originAgentId = turn % 2 === 1 ? 'agent-slopper' : 'agent-pixel'
      expect(call?.agentId).not.toBe(originAgentId)
    }

    const slopperRuns = runCalls.filter((entry) => entry.agentId === 'agent-slopper')
    const pixelRuns = runCalls.filter((entry) => entry.agentId === 'agent-pixel')
    expect(slopperRuns).toHaveLength(5)
    expect(pixelRuns).toHaveLength(5)

    const finalTurnMessage = postedMessages.find((entry) => entry.workItemId === 'wi-10')
    expect(finalTurnMessage?.content).toBe('10 (stop)')
  })

  it('applies queue staggering when session queue routing is used', async () => {
    routeResults.push({
      status: 201,
      body: { created: true, workItemId: 'wi-stagger' },
      workItemId: 'wi-stagger',
      pluginInstanceId: 'plugin-instance-1',
      responseContext: { turn: 1 },
      sessionKey: 'telegram:123:thread:456',
      senderName: 'Josh',
      messageText: 'hello team',
      actor: {
        kind: 'human',
        source: 'telegram',
      },
    })

    const req = new Request('http://localhost/api/webhooks/plugins/test-chat/plugin-instance-1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ body: 'hello team' }),
    })

    const response = await POST(req, {
      params: Promise.resolve({ type: 'test-chat', instanceId: 'plugin-instance-1' }),
    })

    expect(response.status).toBe(201)
    expect(mockCreateQueueMessage).toHaveBeenCalledTimes(2)
    expect(mockUpsertQueueLaneOnMessage).toHaveBeenCalledTimes(2)

    const debounceValues = mockUpsertQueueLaneOnMessage.mock.calls
      .map(([input]) => (input as { debounceMs: number }).debounceMs)
      .sort((a, b) => a - b)

    expect(debounceValues).toEqual([1000, 6000])
    expect(mockRunAgent).not.toHaveBeenCalled()
  })
})
