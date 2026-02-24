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
  mockExtractMentions,
  mockFindAgentByHandle,
  mockFindWorkItemById,
  mockCreateWorkItem,
  mockPublishRoutineEnvelopeFromWorkItem,
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
  const parseAgentConfig = vi.fn((_config: string | null) => ({}))
  const extractMentions = vi.fn<(text: string, knownHandles: string[]) => string[]>(() => [])
  const findAgentByHandle = vi.fn<(handle: string) => Promise<Record<string, unknown> | null>>(() =>
    Promise.resolve(null)
  )
  const findWorkItemById = vi.fn<(id: string) => Promise<Record<string, unknown> | null>>(() =>
    Promise.resolve(null)
  )
  const createWorkItem = vi.fn<
    (input: Record<string, unknown>) => Promise<Record<string, unknown> | null>
  >(() => Promise.resolve(null))
  const publishRoutineEnvelopeFromWorkItem = vi.fn(() => Promise.resolve(undefined))

  const queuedRouteResults: Array<Record<string, unknown>> = []
  const sent: Array<{ workItemId: string; content: string }> = []
  const runInvocations: Array<{
    agentId: string
    workItemId: string
    finalResponse: string
    options?: unknown
  }> = []

  const runAgent = vi.fn((agentId: string, workItemId: string, options?: unknown) => {
    const match = workItemId.match(/(\d+)$/)
    const turn = match ? Number(match[1]) : 0
    const finalResponse = turn >= 10 ? '10 (stop)' : String(turn)
    runInvocations.push({ agentId, workItemId, finalResponse, options })
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
    mockExtractMentions: extractMentions,
    mockFindAgentByHandle: findAgentByHandle,
    mockFindWorkItemById: findWorkItemById,
    mockCreateWorkItem: createWorkItem,
    mockPublishRoutineEnvelopeFromWorkItem: publishRoutineEnvelopeFromWorkItem,
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
  extractMentions: mockExtractMentions,
}))

vi.mock('@nitejar/agent/config', () => ({
  parseAgentConfig: mockParseAgentConfig,
}))

vi.mock('@nitejar/database', () => ({
  getAgentsForPluginInstance: mockGetAgentsForPluginInstance,
  findAgentByHandle: mockFindAgentByHandle,
  updateWorkItem: mockUpdateWorkItem,
  findWorkItemById: mockFindWorkItemById,
  createWorkItem: mockCreateWorkItem,
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

vi.mock('../../../../../../server/services/routines/publish', () => ({
  publishRoutineEnvelopeFromWorkItem: mockPublishRoutineEnvelopeFromWorkItem,
}))

import { POST } from './route'

describe('webhook route agent-origin exclusion collaboration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeResults.length = 0
    postedMessages.length = 0
    runCalls.length = 0
    mockExtractMentions.mockReturnValue([])
    mockFindAgentByHandle.mockResolvedValue(null)
    mockFindWorkItemById.mockResolvedValue(null)
    mockCreateWorkItem.mockResolvedValue(null)
    mockPublishRoutineEnvelopeFromWorkItem.mockResolvedValue(undefined)

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

  it('uses plugin queue config defaults and agent queue overrides when enqueueing', async () => {
    mockGetPluginInstanceWithConfig.mockResolvedValue({
      id: 'plugin-instance-1',
      type: 'test-chat',
      config: JSON.stringify({
        queue: {
          mode: 'collect',
          debounceMs: 2000,
          maxQueued: 20,
        },
      }),
    })
    mockParseAgentConfig.mockImplementation((config: string | null) => {
      if (!config) return {}
      return JSON.parse(config) as Record<string, unknown>
    })
    mockGetAgentsForPluginInstance.mockResolvedValue([
      {
        id: 'agent-slopper',
        handle: 'slopper',
        name: 'Slopper',
        sprite_id: null,
        config: JSON.stringify({
          queue: {
            mode: 'followup',
            debounceMs: 3000,
            maxQueued: 3,
          },
        }),
        status: 'idle',
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 'agent-pixel',
        handle: 'pixel',
        name: 'Pixel',
        sprite_id: null,
        config: JSON.stringify({}),
        status: 'idle',
        created_at: 1,
        updated_at: 1,
      },
    ])
    routeResults.push({
      status: 201,
      body: { created: true, workItemId: 'wi-queue-config' },
      workItemId: 'wi-queue-config',
      pluginInstanceId: 'plugin-instance-1',
      responseContext: { turn: 1 },
      sessionKey: 'slack:C1:thread:1',
      senderName: 'Josh',
      messageText: 'hello team',
      actor: {
        kind: 'human',
        source: 'slack',
      },
    })

    const req = new Request('http://localhost/api/webhooks/plugins/test-chat/plugin-instance-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'hello team' }),
    })
    const response = await POST(req, {
      params: Promise.resolve({ type: 'test-chat', instanceId: 'plugin-instance-1' }),
    })

    expect(response.status).toBe(201)
    expect(mockRunAgent).not.toHaveBeenCalled()
    expect(mockCreateQueueMessage).toHaveBeenCalledTimes(2)
    expect(mockUpsertQueueLaneOnMessage).toHaveBeenCalledTimes(2)

    const laneInputs = mockUpsertQueueLaneOnMessage.mock.calls.map(
      ([input]) =>
        input as {
          agentId: string
          mode: string
          debounceMs: number
          maxQueued: number
        }
    )
    const laneByAgent = new Map(laneInputs.map((input) => [input.agentId, input]))

    const slopperLane = laneByAgent.get('agent-slopper')
    const pixelLane = laneByAgent.get('agent-pixel')

    expect(slopperLane?.mode).toBe('followup')
    expect(slopperLane?.maxQueued).toBe(3)
    expect([3000, 8000]).toContain(slopperLane?.debounceMs)

    expect(pixelLane?.mode).toBe('collect')
    expect(pixelLane?.maxQueued).toBe(20)
    expect([2000, 7000]).toContain(pixelLane?.debounceMs)
  })

  it('returns Discord deferred ACK without waiting for queue persistence', async () => {
    const neverResolves = new Promise<null>(() => {})
    mockCreateQueueMessage.mockImplementationOnce(() => neverResolves)

    routeResults.push({
      status: 200,
      body: { type: 5 },
      workItemId: 'wi-discord-ack',
      pluginInstanceId: 'plugin-instance-1',
      responseContext: { interactionId: 'i-1' },
      sessionKey: 'discord:guild-1:channel-1',
      senderName: 'Josh',
      messageText: '/ask hello',
      actor: {
        kind: 'human',
        source: 'discord',
      },
    })

    const req = new Request('http://localhost/api/webhooks/plugins/discord/plugin-instance-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: '/ask hello' }),
    })

    const response = await Promise.race([
      POST(req, {
        params: Promise.resolve({ type: 'discord', instanceId: 'plugin-instance-1' }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('POST timed out waiting for deferred ACK')), 100)
      ),
    ])

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ type: 5 })
  })

  it('sends exactly one final response and disables streaming events in final mode', async () => {
    mockGetAgentsForPluginInstance.mockResolvedValue([
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
    ])
    mockPluginHandlerGet.mockReturnValue({
      responseMode: 'final',
      postResponse: (
        _integration: unknown,
        workItemId: string,
        content: string
      ): Promise<{ success: true }> => {
        postedMessages.push({ workItemId, content })
        return Promise.resolve({ success: true })
      },
    })
    mockRunAgent.mockResolvedValueOnce({
      job: { id: 'job-final-1' },
      finalResponse: 'Final answer only',
      hitLimit: false,
    })
    routeResults.push({
      status: 201,
      body: { created: true, workItemId: 'wi-final' },
      workItemId: 'wi-final',
      pluginInstanceId: 'plugin-instance-1',
      responseContext: { turn: 1 },
      sessionKey: '',
      senderName: 'Josh',
      messageText: 'hello',
      actor: {
        kind: 'human',
        source: 'slack',
      },
    })

    const req = new Request('http://localhost/api/webhooks/plugins/test-chat/plugin-instance-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'hello' }),
    })
    const response = await POST(req, {
      params: Promise.resolve({ type: 'test-chat', instanceId: 'plugin-instance-1' }),
    })

    expect(response.status).toBe(201)

    await vi.waitFor(() => {
      expect(postedMessages).toEqual([{ workItemId: 'wi-final', content: 'Final answer only' }])
      expect(mockUpdateWorkItem).toHaveBeenCalledWith('wi-final', { status: 'DONE' })
      expect(mockRunAgent).toHaveBeenCalledTimes(1)
    })

    const options = mockRunAgent.mock.calls[0]?.[2] as
      | { responseMode?: string; onEvent?: unknown }
      | undefined
    expect(options?.responseMode).toBe('final')
    expect(options?.onEvent).toBeUndefined()
  })

  it('does not call postResponse when final response is empty in final mode', async () => {
    mockGetAgentsForPluginInstance.mockResolvedValue([
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
    ])
    mockPluginHandlerGet.mockReturnValue({
      responseMode: 'final',
      postResponse: (
        _integration: unknown,
        workItemId: string,
        content: string
      ): Promise<{ success: true }> => {
        postedMessages.push({ workItemId, content })
        return Promise.resolve({ success: true })
      },
    })
    mockRunAgent.mockResolvedValueOnce({
      job: { id: 'job-final-empty' },
      finalResponse: '   ',
      hitLimit: false,
    })
    routeResults.push({
      status: 201,
      body: { created: true, workItemId: 'wi-final-empty' },
      workItemId: 'wi-final-empty',
      pluginInstanceId: 'plugin-instance-1',
      responseContext: { turn: 1 },
      sessionKey: '',
      senderName: 'Josh',
      messageText: 'hello',
      actor: {
        kind: 'human',
        source: 'slack',
      },
    })

    const req = new Request('http://localhost/api/webhooks/plugins/test-chat/plugin-instance-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'hello' }),
    })
    const response = await POST(req, {
      params: Promise.resolve({ type: 'test-chat', instanceId: 'plugin-instance-1' }),
    })

    expect(response.status).toBe(201)

    await vi.waitFor(() => {
      expect(mockUpdateWorkItem).toHaveBeenCalledWith('wi-final-empty', { status: 'DONE' })
    })
    expect(postedMessages).toHaveLength(0)
  })

  it('suppresses only final handoff duplicates when streaming already delivered the same text', async () => {
    mockGetAgentsForPluginInstance.mockResolvedValue([
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
    ])
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
    mockRunAgent.mockImplementationOnce(
      (_agentId: string, _workItemId: string, options?: unknown) => {
        const maybeOnEvent =
          options && typeof options === 'object' && 'onEvent' in options
            ? (options as { onEvent?: (event: unknown) => void }).onEvent
            : undefined
        maybeOnEvent?.({
          type: 'message',
          role: 'assistant',
          content: 'same payload',
        })
        return {
          job: { id: 'job-stream-dup' },
          finalResponse: 'same payload',
          hitLimit: false,
        }
      }
    )
    routeResults.push({
      status: 201,
      body: { created: true, workItemId: 'wi-stream-dup' },
      workItemId: 'wi-stream-dup',
      pluginInstanceId: 'plugin-instance-1',
      responseContext: { turn: 1 },
      sessionKey: '',
      senderName: 'Josh',
      messageText: 'hello',
      actor: {
        kind: 'human',
        source: 'slack',
      },
    })

    const req = new Request('http://localhost/api/webhooks/plugins/test-chat/plugin-instance-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'hello' }),
    })
    const response = await POST(req, {
      params: Promise.resolve({ type: 'test-chat', instanceId: 'plugin-instance-1' }),
    })

    expect(response.status).toBe(201)
    await vi.waitFor(() => {
      expect(postedMessages).toEqual([{ workItemId: 'wi-stream-dup', content: 'same payload' }])
    })
  })

  it('keeps Slack mention handoff disabled by default at instance level', async () => {
    mockGetPluginInstanceWithConfig.mockResolvedValue({
      id: 'plugin-instance-1',
      type: 'slack',
      config: JSON.stringify({
        botToken: 'xoxb-1',
        signingSecret: 'secret',
      }),
    })
    mockRunAgent.mockResolvedValueOnce({
      job: { id: 'job-no-handoff' },
      finalResponse: 'handoff to @pixel please continue',
      hitLimit: false,
    })
    mockExtractMentions.mockReturnValue(['pixel'])
    mockFindAgentByHandle.mockResolvedValue({
      id: 'agent-pixel',
      handle: 'pixel',
      name: 'Pixel',
      sprite_id: null,
      config: null,
      status: 'idle',
      created_at: 1,
      updated_at: 1,
    })
    mockFindWorkItemById.mockResolvedValue({
      id: 'wi-handoff-off',
      plugin_instance_id: 'plugin-instance-1',
      session_key: 'slack:C1:1700000000.1',
      source: 'slack',
      source_ref: 'slack:C1:1700000000.1',
      status: 'NEW',
      title: 'handoff',
      payload: null,
      created_at: 1,
      updated_at: 1,
    })
    routeResults.push({
      status: 201,
      body: { created: true, workItemId: 'wi-handoff-off' },
      workItemId: 'wi-handoff-off',
      pluginInstanceId: 'plugin-instance-1',
      responseContext: { threadTs: '1700000000.1', channel: 'C1' },
      sessionKey: '',
      senderName: 'Agent Relay',
      messageText: 'handoff',
      actor: {
        kind: 'agent',
        agentId: 'agent-pixel',
        handle: 'pixel',
        source: 'slack',
      },
    })

    const req = new Request('http://localhost/api/webhooks/plugins/test-chat/plugin-instance-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'handoff test' }),
    })
    const response = await POST(req, {
      params: Promise.resolve({ type: 'test-chat', instanceId: 'plugin-instance-1' }),
    })

    expect(response.status).toBe(201)
    await vi.waitFor(() => {
      expect(mockRunAgent).toHaveBeenCalled()
    })
    expect(mockCreateWorkItem).not.toHaveBeenCalled()
  })

  it('allows Slack mention handoff when enabled on the instance', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999)
    mockGetPluginInstanceWithConfig.mockResolvedValue({
      id: 'plugin-instance-1',
      type: 'slack',
      config: JSON.stringify({
        botToken: 'xoxb-1',
        signingSecret: 'secret',
        agentMentionHandoffs: true,
      }),
    })
    mockRunAgent.mockImplementation((agentId: string, _workItemId: string, _options?: unknown) => {
      if (agentId === 'agent-slopper') {
        return {
          job: { id: 'job-handoff-on' },
          finalResponse: 'handoff to @pixel please continue',
          hitLimit: false,
        }
      }
      return {
        job: { id: `job-${agentId}` },
        finalResponse: '',
        hitLimit: false,
      }
    })
    mockExtractMentions.mockImplementationOnce(() => ['pixel']).mockImplementation(() => [])
    mockFindAgentByHandle.mockResolvedValue({
      id: 'agent-pixel',
      handle: 'pixel',
      name: 'Pixel',
      sprite_id: null,
      config: null,
      status: 'idle',
      created_at: 1,
      updated_at: 1,
    })
    mockFindWorkItemById.mockResolvedValue({
      id: 'wi-handoff-on',
      plugin_instance_id: 'plugin-instance-1',
      session_key: 'slack:C1:1700000000.2',
      source: 'slack',
      source_ref: 'slack:C1:1700000000.2',
      status: 'NEW',
      title: 'handoff',
      payload: null,
      created_at: 1,
      updated_at: 1,
    })
    mockCreateWorkItem.mockResolvedValue({
      id: 'wi-synth-1',
      plugin_instance_id: 'plugin-instance-1',
      session_key: 'slack:C1:1700000000.2',
      source: 'slack',
      source_ref: 'inter_agent:slopper→@pixel',
      status: 'NEW',
      title: '@slopper mentioned you',
      payload: null,
      created_at: 1,
      updated_at: 1,
    })
    routeResults.push({
      status: 201,
      body: { created: true, workItemId: 'wi-handoff-on' },
      workItemId: 'wi-handoff-on',
      pluginInstanceId: 'plugin-instance-1',
      responseContext: { threadTs: '1700000000.2', channel: 'C1' },
      sessionKey: '',
      senderName: 'Agent Relay',
      messageText: 'handoff',
      actor: {
        kind: 'human',
        externalId: 'U123',
        handle: 'josh',
        source: 'slack',
      },
    })

    const req = new Request('http://localhost/api/webhooks/plugins/test-chat/plugin-instance-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'handoff test' }),
    })
    const response = await POST(req, {
      params: Promise.resolve({ type: 'test-chat', instanceId: 'plugin-instance-1' }),
    })

    expect(response.status).toBe(201)
    await vi.waitFor(() => {
      expect(mockCreateWorkItem).toHaveBeenCalledTimes(1)
      expect(mockPublishRoutineEnvelopeFromWorkItem).toHaveBeenCalledWith('wi-synth-1')
    })
    randomSpy.mockRestore()
  })

  it('enqueues each inbound message when session queue routing is active', async () => {
    routeResults.push(
      {
        status: 201,
        body: { created: true, workItemId: 'wi-queued-1' },
        workItemId: 'wi-queued-1',
        pluginInstanceId: 'plugin-instance-1',
        responseContext: { seq: 1 },
        sessionKey: 'slack:C1:thread:1',
        senderName: 'Josh',
        messageText: 'message one',
        actor: { kind: 'human', source: 'slack' },
      },
      {
        status: 201,
        body: { created: true, workItemId: 'wi-queued-2' },
        workItemId: 'wi-queued-2',
        pluginInstanceId: 'plugin-instance-1',
        responseContext: { seq: 2 },
        sessionKey: 'slack:C1:thread:1',
        senderName: 'Josh',
        messageText: 'message two',
        actor: { kind: 'human', source: 'slack' },
      }
    )

    for (const body of [{ body: 'message one' }, { body: 'message two' }]) {
      const req = new Request('http://localhost/api/webhooks/plugins/test-chat/plugin-instance-1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const response = await POST(req, {
        params: Promise.resolve({ type: 'test-chat', instanceId: 'plugin-instance-1' }),
      })
      expect(response.status).toBe(201)
    }

    expect(mockRunAgent).not.toHaveBeenCalled()
    expect(mockCreateQueueMessage).toHaveBeenCalledTimes(4)
    expect(mockUpsertQueueLaneOnMessage).toHaveBeenCalledTimes(4)
  })

  it('does not enqueue or run when webhook router reports a duplicate with no work item', async () => {
    routeResults.push({
      status: 200,
      body: { duplicate: true, workItemId: 'wi-existing' },
    })

    const req = new Request('http://localhost/api/webhooks/plugins/test-chat/plugin-instance-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'duplicate inbound payload' }),
    })
    const response = await POST(req, {
      params: Promise.resolve({ type: 'test-chat', instanceId: 'plugin-instance-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockCreateQueueMessage).not.toHaveBeenCalled()
    expect(mockUpsertQueueLaneOnMessage).not.toHaveBeenCalled()
    expect(mockRunAgent).not.toHaveBeenCalled()
  })
})
