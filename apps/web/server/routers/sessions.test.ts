import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nitejar/database', () => ({
  addAppSessionParticipants: vi.fn(),
  buildGoalAppSessionKey: vi.fn((goalId: string, sessionId: string) => `app:goal:${goalId}:${sessionId}`),
  buildRoutineAppSessionKey: vi.fn(
    (routineId: string, sessionId: string) => `app:routine:${routineId}:${sessionId}`
  ),
  buildStandaloneAppSessionKey: vi.fn(
    (userId: string, sessionId: string) => `app:standalone:${userId}:${sessionId}`
  ),
  buildTicketAppSessionKey: vi.fn(
    (ticketId: string, sessionId: string) => `app:ticket:${ticketId}:${sessionId}`
  ),
  claimTicket: vi.fn(),
  createTicketLink: vi.fn(),
  createAppSession: vi.fn(),
  createWorkUpdate: vi.fn(),
  findAgentById: vi.fn(),
  findAppSessionByKey: vi.fn(),
  findAppSessionByKeyAndOwner: vi.fn(),
  findGoalById: vi.fn(),
  findTicketById: vi.fn(),
  findTicketBySessionKey: vi.fn(),
  getDb: vi.fn(),
  listAppSessionsByOwnerAndKeys: vi.fn(),
  listAgents: vi.fn(),
  listAppSessionParticipantAgents: vi.fn(),
  listAppSessionsByOwnerAndPrefix: vi.fn(),
  listAppSessionsByOwner: vi.fn(),
  listTicketLinksByTicket: vi.fn(),
  parseAppSessionKey: vi.fn((sessionKey: string) => {
    const typed = sessionKey.match(/^app:(standalone|ticket|goal|routine):([^:]+):([^:]+)$/)
    if (typed) {
      return {
        isAppSession: true,
        isLegacy: false,
        raw: sessionKey,
        contextKind: typed[1],
        contextId: typed[2],
        sessionId: typed[3],
        familyKey: typed[1] === 'standalone' ? null : `app:${typed[1]}:${typed[2]}`,
        ownerUserId: typed[1] === 'standalone' ? typed[2] : null,
      }
    }
    const legacy = sessionKey.match(/^app:([^:]+):([^:]+)$/)
    if (legacy) {
      return {
        isAppSession: true,
        isLegacy: true,
        raw: sessionKey,
        contextKind: 'standalone',
        contextId: legacy[1],
        sessionId: legacy[2],
        familyKey: null,
        ownerUserId: legacy[1],
      }
    }
    return {
      isAppSession: false,
      isLegacy: false,
      raw: sessionKey,
      contextKind: null,
      contextId: null,
      sessionId: null,
      familyKey: null,
      ownerUserId: null,
    }
  }),
}))

vi.mock('../services/app-session-enqueue', () => ({
  enqueueAppSessionMessage: vi.fn(),
}))

import {
  addAppSessionParticipants,
  claimTicket,
  createAppSession,
  createTicketLink,
  createWorkUpdate,
  findAppSessionByKey,
  findAgentById,
  findAppSessionByKeyAndOwner,
  findGoalById,
  findTicketById,
  findTicketBySessionKey,
  getDb,
  listAppSessionsByOwnerAndKeys,
  listAppSessionParticipantAgents,
  listAppSessionsByOwnerAndPrefix,
  listTicketLinksByTicket,
} from '@nitejar/database'
import { enqueueAppSessionMessage } from '../services/app-session-enqueue'
import { sessionsRouter } from './sessions'

const mockedAddAppSessionParticipants = vi.mocked(addAppSessionParticipants)
const mockedClaimTicket = vi.mocked(claimTicket)
const mockedCreateAppSession = vi.mocked(createAppSession)
const mockedCreateTicketLink = vi.mocked(createTicketLink)
const mockedCreateWorkUpdate = vi.mocked(createWorkUpdate)
const mockedFindAppSessionByKey = vi.mocked(findAppSessionByKey)
const mockedFindAgentById = vi.mocked(findAgentById)
const mockedFindAppSessionByKeyAndOwner = vi.mocked(findAppSessionByKeyAndOwner)
const mockedFindGoalById = vi.mocked(findGoalById)
const mockedFindTicketById = vi.mocked(findTicketById)
const mockedFindTicketBySessionKey = vi.mocked(findTicketBySessionKey)
const mockedGetDb = vi.mocked(getDb)
const mockedListAppSessionsByOwnerAndKeys = vi.mocked(listAppSessionsByOwnerAndKeys)
const mockedListAppSessionParticipantAgents = vi.mocked(listAppSessionParticipantAgents)
const mockedListAppSessionsByOwnerAndPrefix = vi.mocked(listAppSessionsByOwnerAndPrefix)
const mockedListTicketLinksByTicket = vi.mocked(listTicketLinksByTicket)
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
      session_key: 'app:standalone:user-1:s1',
      owner_user_id: 'user-1',
      primary_agent_id: 'agent-1',
      title: null,
      forked_from_session_key: null,
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
    mockedFindTicketBySessionKey.mockResolvedValue(null)
    mockedFindAppSessionByKey.mockResolvedValue(null)
    mockedFindAgentById.mockResolvedValue({
      id: 'agent-1',
      handle: 'scout',
      name: 'Scout',
      sprite_id: null,
      config: null,
      status: 'idle',
      created_at: 1,
      updated_at: 1,
    })
    mockedFindGoalById.mockResolvedValue(null)
    mockedFindTicketById.mockResolvedValue({
      id: 'ticket-1',
      goal_id: 'goal-1',
      parent_ticket_id: null,
      title: 'Triage the cleanup lane',
      body: 'Inspect the queue and move the next concrete task.',
      status: 'ready',
      assignee_kind: 'agent',
      assignee_ref: 'agent-1',
      created_by_user_id: 'user-1',
      claimed_at: null,
      claimed_by_kind: null,
      claimed_by_ref: null,
      created_at: 1,
      updated_at: 1,
      archived_at: null,
      sort_order: 1,
    })
    mockedCreateAppSession.mockImplementation(async (data: any) => ({
      ...data,
      created_at: 1,
      updated_at: 1,
      last_activity_at: 1,
    }))
    mockedListAppSessionsByOwnerAndPrefix.mockResolvedValue([])
    mockedListAppSessionsByOwnerAndKeys.mockResolvedValue([])
    mockedListTicketLinksByTicket.mockResolvedValue([])
    mockedGetDb.mockImplementation(() => {
      const query = {
        select: () => query,
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        executeTakeFirst: async () => null,
      }
      return {
        selectFrom: () => query,
      } as any
    })
  })

  it('routes to primary agent when no mention is present', async () => {
    const result = await caller.sendMessage({
      sessionKey: 'app:standalone:user-1:s1',
      message: 'hello there',
    })

    expect(result.ok).toBe(true)
    expect(result.workItemId).toBe('work-1')
    expect(result.targetAgentIds).toEqual(['agent-1'])
    expect(mockedEnqueueAppSessionMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'app:standalone:user-1:s1',
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
      sessionKey: 'app:standalone:user-1:s1',
      message: '@scout and @researcher please compare options',
    })

    expect(result.targetAgentIds).toEqual(['agent-1', 'agent-2'])
    expect(mockedEnqueueAppSessionMessage).toHaveBeenCalledTimes(1)
    const targetIds =
      mockedEnqueueAppSessionMessage.mock.calls[0]?.[0].targetAgents.map((agent) => agent.id) ?? []
    expect(targetIds.sort()).toEqual(['agent-1', 'agent-2'])
  })
})

describe('sessions router listRelated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedListAppSessionsByOwnerAndPrefix.mockResolvedValue([])
    mockedListAppSessionsByOwnerAndKeys.mockResolvedValue([])
    mockedListTicketLinksByTicket.mockResolvedValue([])
  })

  it('includes ticket-linked routine sessions alongside typed ticket sessions', async () => {
    mockedListAppSessionsByOwnerAndPrefix.mockResolvedValue([
      {
        session_key: 'app:ticket:ticket-1:sibling',
        owner_user_id: 'user-1',
        primary_agent_id: 'agent-1',
        title: 'Main ticket session',
        forked_from_session_key: null,
        created_at: 10,
        updated_at: 10,
        last_activity_at: 12,
      },
    ] as any)
    mockedListTicketLinksByTicket.mockResolvedValue([
      {
        id: 'link-1',
        ticket_id: 'ticket-1',
        kind: 'session',
        ref: 'app:routine:routine-1:deferred',
        label: 'Deferred execution',
        metadata_json: null,
        created_by_kind: 'system',
        created_by_ref: 'scheduler',
        created_at: 11,
      },
    ] as any)
    mockedListAppSessionsByOwnerAndKeys.mockResolvedValue([
      {
        session_key: 'app:routine:routine-1:deferred',
        owner_user_id: 'user-1',
        primary_agent_id: 'agent-1',
        title: 'Deferred execution',
        forked_from_session_key: null,
        created_at: 11,
        updated_at: 11,
        last_activity_at: 13,
      },
    ] as any)

    const result = await caller.listRelated({ ticketId: 'ticket-1', limit: 6 })

    expect(mockedListTicketLinksByTicket).toHaveBeenCalledWith('ticket-1')
    expect(result.items.map((item) => item.sessionKey)).toEqual([
      'app:routine:routine-1:deferred',
      'app:ticket:ticket-1:sibling',
    ])
  })
})

describe('sessions router runTicketNow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedFindAgentById.mockResolvedValue({
      id: 'agent-1',
      handle: 'scout',
      name: 'Scout',
      sprite_id: null,
      config: null,
      status: 'idle',
      created_at: 1,
      updated_at: 1,
    })
    mockedFindTicketById.mockResolvedValue({
      id: 'ticket-1',
      goal_id: 'goal-1',
      parent_ticket_id: null,
      title: 'Triage the cleanup lane',
      body: 'Inspect the queue and move the next concrete task.',
      status: 'ready',
      assignee_kind: 'agent',
      assignee_ref: 'agent-1',
      created_by_user_id: 'user-1',
      claimed_at: null,
      claimed_by_kind: null,
      claimed_by_ref: null,
      created_at: 1,
      updated_at: 1,
      archived_at: null,
      sort_order: 1,
    })
    mockedFindGoalById.mockResolvedValue({
      id: 'goal-1',
      title: 'Reduce seeded fat without losing useful demo surface',
      status: 'active',
      outcome: 'Lean org, visible receipts',
      created_by_user_id: 'user-1',
      parent_goal_id: null,
      progress: null,
      progress_target: null,
      progress_unit: null,
      sort_order: 1,
      archived_at: null,
      created_at: 1,
      updated_at: 1,
    } as any)
    mockedFindAppSessionByKeyAndOwner.mockResolvedValue(null)
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
    ])
    mockedEnqueueAppSessionMessage.mockResolvedValue({
      workItemId: 'work-99',
      targetAgentIds: ['agent-1'],
    })
  })

  it('creates a fresh typed ticket session and enqueues a real work item', async () => {
    const result = await caller.runTicketNow({ ticketId: 'ticket-1' })

    expect(result.ok).toBe(true)
    expect(result.workItemId).toBe('work-99')
    expect(mockedCreateAppSession).toHaveBeenCalledTimes(1)
    expect(mockedCreateAppSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        session_key: expect.stringMatching(/^app:ticket:ticket-1:/),
        owner_user_id: 'user-1',
        primary_agent_id: 'agent-1',
        forked_from_session_key: null,
      }),
      undefined
    )
    expect(mockedCreateTicketLink).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ticket_id: 'ticket-1',
        kind: 'session',
        ref: expect.stringMatching(/^app:ticket:ticket-1:/),
      }),
      undefined
    )
    expect(mockedClaimTicket).toHaveBeenCalledWith(
      'ticket-1',
      expect.objectContaining({
        assigneeKind: 'agent',
        assigneeRef: 'agent-1',
      })
    )
    expect(mockedCreateWorkUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-1',
        body: expect.stringContaining('Queued execution in session'),
      })
    )
    expect(mockedEnqueueAppSessionMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        targetAgents: [{ id: 'agent-1', handle: 'scout', name: 'Scout' }],
        workContext: expect.objectContaining({
          ticketId: 'ticket-1',
          goalId: 'goal-1',
        }),
      })
    )
  })

  it('creates a fresh typed ticket session for the chosen agent and targets that agent directly', async () => {
    mockedFindTicketById.mockResolvedValueOnce({
      id: 'ticket-1',
      goal_id: null,
      parent_ticket_id: null,
      title: 'Shift execution to researcher',
      body: null,
      status: 'in_progress',
      assignee_kind: 'agent',
      assignee_ref: 'agent-1',
      created_by_user_id: 'user-1',
      claimed_at: 1,
      claimed_by_kind: 'user',
      claimed_by_ref: 'user-1',
      created_at: 1,
      updated_at: 1,
      archived_at: null,
      sort_order: 1,
    })
    mockedFindAgentById.mockResolvedValueOnce({
      id: 'agent-2',
      handle: 'researcher',
      name: 'Researcher',
      sprite_id: null,
      config: null,
      status: 'idle',
      created_at: 1,
      updated_at: 1,
    })
    mockedListAppSessionParticipantAgents.mockResolvedValueOnce([
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
    ])

    const result = await caller.runTicketNow({
      ticketId: 'ticket-1',
      agentId: 'agent-2',
      message: 'Pick up this ticket now and leave a receipt.',
    })

    expect(result.ok).toBe(true)
    expect(mockedCreateAppSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        session_key: expect.stringMatching(/^app:ticket:ticket-1:/),
        primary_agent_id: 'agent-2',
      }),
      undefined
    )
    expect(mockedClaimTicket).toHaveBeenCalledWith(
      'ticket-1',
      expect.objectContaining({
        assigneeRef: 'agent-2',
      })
    )
    expect(mockedEnqueueAppSessionMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: expect.stringMatching(/^app:ticket:ticket-1:/),
        message: 'Pick up this ticket now and leave a receipt.',
        targetAgents: [{ id: 'agent-2', handle: 'researcher', name: 'Researcher' }],
      })
    )
  })
})

describe('sessions router session creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedFindAgentById.mockResolvedValue({
      id: 'agent-1',
      handle: 'scout',
      name: 'Scout',
      sprite_id: null,
      config: null,
      status: 'idle',
      created_at: 1,
      updated_at: 1,
    })
    mockedCreateAppSession.mockImplementation(async (data: any) => ({
      ...data,
      created_at: 1,
      updated_at: 1,
      last_activity_at: 1,
    }))
  })

  it('creates a fresh typed standalone session instead of resuming a recent one', async () => {
    const result = await caller.startOrResume({ agentId: 'agent-1' })

    expect(result.sessionKey).toMatch(/^app:standalone:user-1:/)
    expect(mockedCreateAppSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        session_key: expect.stringMatching(/^app:standalone:user-1:/),
        primary_agent_id: 'agent-1',
        forked_from_session_key: null,
      }),
      undefined
    )
  })
})

describe('sessions router forkSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedFindAppSessionByKeyAndOwner.mockResolvedValue({
      session_key: 'app:ticket:ticket-1:s1',
      owner_user_id: 'user-1',
      primary_agent_id: 'agent-1',
      title: 'Ticket conversation',
      forked_from_session_key: null,
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
    mockedCreateAppSession.mockImplementation(async (data: any) => ({
      ...data,
      created_at: 1,
      updated_at: 1,
      last_activity_at: 1,
    }))
  })

  it('forks into a fresh typed sibling session with lineage', async () => {
    const result = await caller.forkSession({ sessionKey: 'app:ticket:ticket-1:s1' })

    expect(result.sessionKey).toMatch(/^app:ticket:ticket-1:/)
    expect(mockedCreateAppSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        session_key: expect.stringMatching(/^app:ticket:ticket-1:/),
        forked_from_session_key: 'app:ticket:ticket-1:s1',
      }),
      undefined
    )
    expect(mockedAddAppSessionParticipants).toHaveBeenCalledWith(
      expect.objectContaining({
        agentIds: ['agent-2'],
      })
    )
  })
})
