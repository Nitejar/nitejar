import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nitejar/database', () => ({
  createWorkItem: vi.fn(),
  enqueueToLane: vi.fn(),
  touchAppSessionLastActivity: vi.fn(),
}))

vi.mock('./routines/publish', () => ({
  publishRoutineEnvelopeFromWorkItem: vi.fn(),
}))

import { createWorkItem, enqueueToLane, touchAppSessionLastActivity } from '@nitejar/database'
import { enqueueAppSessionMessage } from './app-session-enqueue'
import { publishRoutineEnvelopeFromWorkItem } from './routines/publish'

const mockedCreateWorkItem = vi.mocked(createWorkItem)
const mockedEnqueueToLane = vi.mocked(enqueueToLane)
const mockedTouchAppSessionLastActivity = vi.mocked(touchAppSessionLastActivity)
const mockedPublishRoutineEnvelope = vi.mocked(publishRoutineEnvelopeFromWorkItem)

describe('enqueueAppSessionMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedCreateWorkItem.mockResolvedValue({
      id: 'work-1',
      plugin_instance_id: null,
      session_key: 'app:user-1:s1',
      source: 'app_chat',
      source_ref: 'app-user:user-1',
      status: 'NEW',
      title: 'hello there',
      payload: null,
      created_at: 1,
      updated_at: 1,
    })
    mockedEnqueueToLane.mockResolvedValue({
      id: 'q-1',
      queue_key: 'app:user-1:s1:agent-1',
      work_item_id: 'work-1',
      plugin_instance_id: null,
      response_context: null,
      text: 'hello there',
      sender_name: 'Josh',
      arrived_at: 1,
      status: 'pending',
      dispatch_id: null,
      drop_reason: null,
      created_at: 1,
    })
    mockedTouchAppSessionLastActivity.mockResolvedValue({
      session_key: 'app:user-1:s1',
      owner_user_id: 'user-1',
      primary_agent_id: 'agent-1',
      title: null,
      created_at: 1,
      updated_at: 2,
      last_activity_at: 2,
    })
    mockedPublishRoutineEnvelope.mockResolvedValue({
      enqueued: true,
      eventKey: 'work_item:1',
    })
  })

  it('creates an app_chat work item and enqueues steer lane messages', async () => {
    const result = await enqueueAppSessionMessage({
      sessionKey: 'app:user-1:s1',
      userId: 'user-1',
      senderName: 'Josh',
      message: 'hello there',
      targetAgents: [
        { id: 'agent-1', handle: 'scout', name: 'Scout' },
        { id: 'agent-2', handle: 'researcher', name: 'Researcher' },
      ],
      clientMessageId: 'client-1',
    })

    expect(result).toEqual({
      workItemId: 'work-1',
      targetAgentIds: ['agent-1', 'agent-2'],
    })

    expect(mockedCreateWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        plugin_instance_id: null,
        source: 'app_chat',
        source_ref: 'app-user:user-1',
        session_key: 'app:user-1:s1',
        status: 'NEW',
      })
    )

    const firstCreateWorkItemCall = mockedCreateWorkItem.mock.calls[0] as
      | [{ payload: string | null }]
      | undefined
    const payloadRaw = firstCreateWorkItemCall?.[0]?.payload
    const payload = payloadRaw ? (JSON.parse(payloadRaw) as Record<string, unknown>) : null
    expect(payload).toMatchObject({
      body: 'hello there',
      senderName: 'Josh',
      senderUserId: 'user-1',
      sessionKey: 'app:user-1:s1',
      targetAgentIds: ['agent-1', 'agent-2'],
      clientMessageId: 'client-1',
    })

    expect(mockedEnqueueToLane).toHaveBeenCalledTimes(2)
    expect(mockedEnqueueToLane).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        queue_key: 'app:user-1:s1:agent-1',
        work_item_id: 'work-1',
        plugin_instance_id: null,
        response_context: null,
        text: 'hello there',
        sender_name: 'Josh',
        status: 'pending',
      }),
      expect.objectContaining({
        queueKey: 'app:user-1:s1:agent-1',
        sessionKey: 'app:user-1:s1',
        agentId: 'agent-1',
        pluginInstanceId: null,
        debounceMs: 1000,
        maxQueued: 10,
        mode: 'steer',
      })
    )
    const firstLaneOptions = (
      mockedEnqueueToLane.mock.calls[0] as [unknown, { arrivedAt?: unknown }] | undefined
    )?.[1]
    expect(typeof firstLaneOptions?.arrivedAt).toBe('number')
    expect(mockedEnqueueToLane).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        queue_key: 'app:user-1:s1:agent-2',
        work_item_id: 'work-1',
        response_context: null,
        text: 'hello there',
      }),
      expect.objectContaining({
        queueKey: 'app:user-1:s1:agent-2',
        agentId: 'agent-2',
        debounceMs: 1000,
        maxQueued: 10,
        mode: 'steer',
      })
    )
    expect(mockedTouchAppSessionLastActivity).toHaveBeenCalledWith('app:user-1:s1')
    expect(mockedPublishRoutineEnvelope).toHaveBeenCalledWith('work-1')
  })

  it('does not fail when routine envelope publish throws', async () => {
    mockedPublishRoutineEnvelope.mockRejectedValueOnce(new Error('publish failed'))

    const result = await enqueueAppSessionMessage({
      sessionKey: 'app:user-1:s1',
      userId: 'user-1',
      senderName: 'Josh',
      message: 'hello there',
      targetAgents: [{ id: 'agent-1', handle: 'scout', name: 'Scout' }],
    })

    expect(result.workItemId).toBe('work-1')
    expect(result.targetAgentIds).toEqual(['agent-1'])
  })
})
