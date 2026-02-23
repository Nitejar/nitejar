import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nitejar/database', () => ({
  addAppSessionParticipants: vi.fn(),
  createAppSession: vi.fn(),
  findAgentById: vi.fn(),
  findAppSessionByKeyAndOwner: vi.fn(),
  getDb: vi.fn(),
  listAgents: vi.fn(),
  listAppSessionParticipantAgents: vi.fn(),
  listAppSessionsByOwner: vi.fn(),
}))

vi.mock('../services/app-session-enqueue', () => ({
  enqueueAppSessionMessage: vi.fn(),
}))

import { findAppSessionByKeyAndOwner, listAppSessionParticipantAgents } from '@nitejar/database'
import { enqueueAppSessionMessage } from '../services/app-session-enqueue'
import { sessionsRouter } from './sessions'

const mockedFindAppSessionByKeyAndOwner = vi.mocked(findAppSessionByKeyAndOwner)
const mockedListAppSessionParticipantAgents = vi.mocked(listAppSessionParticipantAgents)
const mockedEnqueueAppSessionMessage = vi.mocked(enqueueAppSessionMessage)

const caller = sessionsRouter.createCaller({
  session: {
    user: {
      id: 'user-1',
      name: 'Josh',
    },
  } as never,
})

describe('sessions router sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedFindAppSessionByKeyAndOwner.mockResolvedValue({
      session_key: 'app:user-1:s1',
      owner_user_id: 'user-1',
      primary_agent_id: 'agent-1',
      title: null,
      created_at: 1,
      updated_at: 1,
      last_activity_at: 1,
    })
    mockedListAppSessionParticipantAgents.mockResolvedValue([
      {
        id: 'agent-1',
        handle: 'scout',
        name: 'Scout',
        sprite_id: null,
        config: null,
        status: 'idle',
        created_at: 1,
        updated_at: 1,
        added_at: 1,
        added_by_user_id: 'user-1',
      },
      {
        id: 'agent-2',
        handle: 'researcher',
        name: 'Researcher',
        sprite_id: null,
        config: null,
        status: 'idle',
        created_at: 1,
        updated_at: 1,
        added_at: 2,
        added_by_user_id: 'user-1',
      },
    ])
    mockedEnqueueAppSessionMessage.mockResolvedValue({
      workItemId: 'work-1',
      targetAgentIds: ['agent-1'],
    })
  })

  it('routes to primary agent when no mention is present', async () => {
    const result = await caller.sendMessage({
      sessionKey: 'app:user-1:s1',
      message: 'hello there',
    })

    expect(result.ok).toBe(true)
    expect(result.workItemId).toBe('work-1')
    expect(result.targetAgentIds).toEqual(['agent-1'])
    expect(mockedEnqueueAppSessionMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'app:user-1:s1',
        userId: 'user-1',
        senderName: 'Josh',
        message: 'hello there',
        clientMessageId: undefined,
      })
    )
    const targetIds =
      mockedEnqueueAppSessionMessage.mock.calls[0]?.[0].targetAgents.map((agent) => agent.id) ?? []
    expect(targetIds).toEqual(['agent-1'])
  })

  it('routes to all mentioned participants', async () => {
    mockedEnqueueAppSessionMessage.mockResolvedValueOnce({
      workItemId: 'work-2',
      targetAgentIds: ['agent-1', 'agent-2'],
    })

    const result = await caller.sendMessage({
      sessionKey: 'app:user-1:s1',
      message: '@scout and @researcher please compare options',
    })

    expect(result.targetAgentIds).toEqual(['agent-1', 'agent-2'])
    expect(mockedEnqueueAppSessionMessage).toHaveBeenCalledTimes(1)
    const targetIds =
      mockedEnqueueAppSessionMessage.mock.calls[0]?.[0].targetAgents.map((agent) => agent.id) ?? []
    expect(targetIds.sort()).toEqual(['agent-1', 'agent-2'])
  })
})
