import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolContext } from './tools'
import * as Database from '@nitejar/database'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    assertAgentGrant: vi.fn(),
    claimTicket: vi.fn(),
    createOneShotRoutineSchedule: vi.fn(),
    createTicketLink: vi.fn(),
    createWorkItem: vi.fn(),
    createWorkUpdate: vi.fn(),
    enqueueToLane: vi.fn(),
    findAgentById: vi.fn(),
    findTicketById: vi.fn(),
    findTicketBySessionKey: vi.fn(),
    findTicketByWorkItemId: vi.fn(),
    getDb: vi.fn(() => ({
      selectFrom: () => ({
        select: () => ({
          where: () => ({
            executeTakeFirst: vi.fn().mockResolvedValue(null),
          }),
        }),
      }),
    })),
    listAppSessionParticipantAgents: vi.fn(),
    listGoals: vi.fn(),
    listTicketLinksByTicket: vi.fn(),
    listTickets: vi.fn(),
    findGoalById: vi.fn(),
    touchAppSessionLastActivity: vi.fn(),
    listLinkedWorkItemsForTicket: vi.fn(),
  }
})

const mockedClaimTicket = vi.mocked(Database.claimTicket)
const mockedCreateOneShotRoutineSchedule = vi.mocked(Database.createOneShotRoutineSchedule)
const mockedListGoals = vi.mocked(Database.listGoals)
const mockedListTickets = vi.mocked(Database.listTickets)
const mockedFindAgentById = vi.mocked(Database.findAgentById)
const mockedFindGoalById = vi.mocked(Database.findGoalById)
const mockedFindTicketById = vi.mocked(Database.findTicketById)
const mockedFindTicketBySessionKey = vi.mocked(Database.findTicketBySessionKey)
const mockedFindTicketByWorkItemId = vi.mocked(Database.findTicketByWorkItemId)
const mockedCreateWorkItem = vi.mocked(Database.createWorkItem)
const mockedEnqueueToLane = vi.mocked(Database.enqueueToLane)
const mockedCreateTicketLink = vi.mocked(Database.createTicketLink)
const mockedCreateWorkUpdate = vi.mocked(Database.createWorkUpdate)
const mockedListAppSessionParticipantAgents = vi.mocked(Database.listAppSessionParticipantAgents)
const mockedListTicketLinksByTicket = vi.mocked(Database.listTicketLinksByTicket)
const mockedTouchAppSessionLastActivity = vi.mocked(Database.touchAppSessionLastActivity)
const mockedListLinkedWorkItemsForTicket = vi.mocked(Database.listLinkedWorkItemsForTicket)

const context: ToolContext = {
  agentId: 'agent-1',
  cwd: '/workspace',
  spriteName: 'home',
  sessionKey: 'app:user-1:proof',
}

describe('work tools', () => {
  beforeEach(() => {
    mockedClaimTicket.mockReset()
    mockedCreateOneShotRoutineSchedule.mockReset()
    mockedListGoals.mockReset()
    mockedListTickets.mockReset()
    mockedFindAgentById.mockReset()
    mockedFindGoalById.mockReset()
    mockedFindTicketById.mockReset()
    mockedFindTicketBySessionKey.mockReset()
    mockedFindTicketByWorkItemId.mockReset()
    mockedCreateWorkItem.mockReset()
    mockedEnqueueToLane.mockReset()
    mockedCreateTicketLink.mockReset()
    mockedCreateWorkUpdate.mockReset()
    mockedListAppSessionParticipantAgents.mockReset()
    mockedListTicketLinksByTicket.mockReset()
    mockedTouchAppSessionLastActivity.mockReset()
    mockedListLinkedWorkItemsForTicket.mockReset()
  })

  it('splits comma-delimited ticket statuses for search_tickets', async () => {
    mockedListTickets.mockResolvedValue([
      {
        id: 'ticket-1',
        goal_id: 'goal-1',
        title: 'Investigate work status parsing',
        body: null,
        status: 'in_progress',
        assignee_kind: 'agent',
        assignee_ref: 'agent-1',
        claimed_by_kind: 'agent',
        claimed_by_ref: 'agent-1',
        claimed_at: null,
        archived_at: null,
        created_at: 0,
        updated_at: 0,
      } as Database.Ticket,
    ])
    mockedFindGoalById.mockResolvedValue({
      id: 'goal-1',
      parent_goal_id: null,
      title: 'Stabilize heartbeat search',
      outcome: 'Heartbeat sees active tickets correctly.',
      owner_kind: 'agent',
      owner_ref: 'agent-1',
      status: 'active',
      archived_at: null,
      created_at: 0,
      updated_at: 0,
    } as Database.Goal)

    const result = await executeTool(
      'search_tickets',
      {
        goal_id: 'goal-1',
        status: 'ready, in_progress, blocked',
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedListTickets).toHaveBeenCalledWith(
      expect.objectContaining({
        goalId: 'goal-1',
        statuses: ['ready', 'in_progress', 'blocked'],
      })
    )
    expect(result.output).toContain('Investigate work status parsing')
  })

  it('splits comma-delimited goal statuses for search_goals', async () => {
    mockedListGoals.mockResolvedValue([
      {
        id: 'goal-1',
        parent_goal_id: null,
        title: 'Stabilize heartbeat search',
        outcome: 'Heartbeat sees active tickets correctly.',
        owner_kind: 'agent',
        owner_ref: 'agent-1',
        status: 'blocked',
        archived_at: null,
        created_at: 0,
        updated_at: 0,
      } as Database.Goal,
    ])

    const result = await executeTool(
      'search_goals',
      {
        status: 'active, blocked',
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedListGoals).toHaveBeenCalledWith(
      expect.objectContaining({
        statuses: ['active', 'blocked'],
      })
    )
    expect(result.output).toContain('Stabilize heartbeat search')
  })

  it('rejects team-scoped work updates for post_work_update', async () => {
    const result = await executeTool(
      'post_work_update',
      {
        team_id: 'team-ops',
        kind: 'heartbeat',
        body: 'Still moving.',
      },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('team_id is no longer supported')
    expect(mockedCreateWorkUpdate).not.toHaveBeenCalled()
  })

  it('passes structured metadata through post_work_update', async () => {
    mockedFindTicketById.mockResolvedValue({
      id: 'ticket-1',
      goal_id: 'goal-1',
      title: 'Proof lane ticket',
      body: null,
      status: 'in_progress',
      assignee_kind: 'agent',
      assignee_ref: 'agent-1',
      claimed_by_kind: 'agent',
      claimed_by_ref: 'agent-1',
      claimed_at: null,
      archived_at: null,
      created_at: 0,
      updated_at: 0,
    } as Database.Ticket)
    mockedCreateWorkUpdate.mockResolvedValue({
      id: 'update-1',
    } as Database.WorkUpdate)

    const result = await executeTool(
      'post_work_update',
      {
        ticket_id: 'ticket-1',
        kind: 'note',
        body: 'Cycle advanced.',
        metadata_json: {
          proofCampaignId: 'proof-1',
          autonomyCycleId: 'cycle-3',
          frontierAdvanced: true,
        },
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedCreateWorkUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-1',
        metadata_json:
          '{"proofCampaignId":"proof-1","autonomyCycleId":"cycle-3","frontierAdvanced":true}',
      })
    )
  })

  it('normalizes ticket-scoped work updates to the ticket goal', async () => {
    mockedFindTicketById.mockResolvedValue({
      id: 'ticket-1',
      goal_id: 'goal-1',
      title: 'Proof lane ticket',
      body: null,
      status: 'in_progress',
      assignee_kind: 'agent',
      assignee_ref: 'agent-1',
      claimed_by_kind: 'agent',
      claimed_by_ref: 'agent-1',
      claimed_at: null,
      archived_at: null,
      created_at: 0,
      updated_at: 0,
    } as Database.Ticket)
    mockedCreateWorkUpdate.mockResolvedValue({
      id: 'update-2',
    } as Database.WorkUpdate)

    const result = await executeTool(
      'post_work_update',
      {
        goal_id: 'mistyped-goal',
        ticket_id: 'ticket-1',
        kind: 'note',
        body: 'Cycle advanced.',
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedCreateWorkUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        goal_id: 'goal-1',
        ticket_id: 'ticket-1',
      })
    )
  })

  it('links a work item receipt to a ticket and mirrors it in a work update', async () => {
    mockedFindTicketById.mockResolvedValue({
      id: 'ticket-1',
      goal_id: 'goal-1',
      title: 'Proof lane ticket',
      body: null,
      status: 'in_progress',
      assignee_kind: 'agent',
      assignee_ref: 'agent-1',
      claimed_by_kind: 'agent',
      claimed_by_ref: 'agent-1',
      claimed_at: null,
      archived_at: null,
      created_at: 0,
      updated_at: 0,
    } as Database.Ticket)
    mockedFindTicketByWorkItemId.mockResolvedValue(null)
    mockedCreateTicketLink.mockResolvedValue({
      id: 'link-1',
    } as Database.TicketLink)
    mockedCreateWorkUpdate.mockResolvedValue({
      id: 'update-1',
    } as Database.WorkUpdate)

    const result = await executeTool(
      'link_ticket_receipt',
      {
        ticket_id: 'ticket-1',
        kind: 'work_item',
        ref: 'work-item-9',
        label: 'Cycle work item',
        metadata_json: '{"autonomyCycleId":"cycle-4","receiptKind":"bounded_step"}',
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedCreateTicketLink).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-1',
        kind: 'work_item',
        ref: 'work-item-9',
        label: 'Cycle work item',
        metadata_json: '{"autonomyCycleId":"cycle-4","receiptKind":"bounded_step"}',
        created_by_kind: 'agent',
        created_by_ref: 'agent-1',
      })
    )
    expect(mockedCreateWorkUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-1',
        body: 'Linked work_item receipt work-item-9.',
        metadata_json: '{"autonomyCycleId":"cycle-4","receiptKind":"bounded_step"}',
      })
    )
  })

  it('queues an immediate ticket run in the current session and links the work item receipt', async () => {
    mockedFindTicketById.mockResolvedValue({
      id: 'ticket-1',
      goal_id: 'goal-1',
      title: 'Advance the cleanup lane',
      body: 'Pick the next bounded action and leave a receipt.',
      status: 'ready',
      assignee_kind: 'agent',
      assignee_ref: 'agent-2',
      claimed_by_kind: null,
      claimed_by_ref: null,
      claimed_at: null,
      archived_at: null,
      created_at: 0,
      updated_at: 0,
    } as Database.Ticket)
    mockedFindAgentById.mockResolvedValue({
      id: 'agent-1',
      handle: 'ceo',
      name: 'CEO',
      sprite_id: null,
      config: null,
      status: 'idle',
      created_at: 0,
      updated_at: 0,
    } as Database.Agent)
    mockedFindGoalById.mockResolvedValue({
      id: 'goal-1',
      parent_goal_id: null,
      title: 'Reduce seeded fat',
      outcome: 'Leave a lean org with receipts.',
      owner_kind: 'agent',
      owner_ref: 'agent-1',
      status: 'active',
      archived_at: null,
      created_at: 0,
      updated_at: 0,
    } as Database.Goal)
    mockedListAppSessionParticipantAgents.mockResolvedValue([
      {
        id: 'agent-1',
        handle: 'ceo',
        name: 'CEO',
        sprite_id: null,
        config: null,
        status: 'idle',
        created_at: 0,
        updated_at: 0,
        added_at: 0,
        added_by_user_id: 'user-1',
      } as any,
    ])
    mockedListLinkedWorkItemsForTicket.mockResolvedValue([])
    mockedCreateWorkItem.mockResolvedValue({
      id: 'work-77',
    } as Database.WorkItem)
    mockedFindTicketByWorkItemId.mockResolvedValue(null)

    const result = await executeTool(
      'run_ticket_now',
      {
        ticket_id: 'ticket-1',
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedClaimTicket).toHaveBeenCalledWith(
      'ticket-1',
      expect.objectContaining({
        assigneeKind: 'agent',
        assigneeRef: 'agent-1',
        claimedByKind: 'agent',
        claimedByRef: 'agent-1',
      })
    )
    expect(mockedCreateWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        session_key: 'app:user-1:proof',
        source: 'app_chat',
        source_ref: 'app-agent:agent-1:ticket:ticket-1',
      })
    )
    expect(mockedEnqueueToLane).toHaveBeenCalledWith(
      expect.objectContaining({
        queue_key: 'app:user-1:proof:agent-1',
        work_item_id: 'work-77',
      }),
      expect.objectContaining({
        queueKey: 'app:user-1:proof:agent-1',
        sessionKey: 'app:user-1:proof',
        agentId: 'agent-1',
        mode: 'steer',
      })
    )
    expect(mockedCreateTicketLink).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-1',
        kind: 'work_item',
        ref: 'work-77',
        created_by_kind: 'agent',
        created_by_ref: 'agent-1',
      })
    )
    expect(mockedTouchAppSessionLastActivity).toHaveBeenCalledWith('app:user-1:proof')
    expect(result.output).toContain('work-77')
  })

  it('schedules a one-shot follow-up instead of self-steering when run_ticket_now is called mid-run', async () => {
    mockedFindTicketById.mockResolvedValue({
      id: 'ticket-1',
      goal_id: 'goal-1',
      title: 'Advance the cleanup lane',
      body: 'Pick the next bounded action and leave a receipt.',
      status: 'ready',
      assignee_kind: 'agent',
      assignee_ref: 'agent-2',
      claimed_by_kind: null,
      claimed_by_ref: null,
      claimed_at: null,
      archived_at: null,
      created_at: 0,
      updated_at: 0,
    } as Database.Ticket)
    mockedFindAgentById.mockResolvedValue({
      id: 'agent-1',
      handle: 'ceo',
      name: 'CEO',
      sprite_id: null,
      config: null,
      status: 'idle',
      created_at: 0,
      updated_at: 0,
    } as Database.Agent)
    mockedFindGoalById.mockResolvedValue({
      id: 'goal-1',
      parent_goal_id: null,
      title: 'Reduce seeded fat',
      outcome: 'Leave a lean org with receipts.',
      owner_kind: 'agent',
      owner_ref: 'agent-1',
      status: 'active',
      archived_at: null,
      created_at: 0,
      updated_at: 0,
    } as Database.Goal)
    mockedListAppSessionParticipantAgents.mockResolvedValue([
      {
        id: 'agent-1',
        handle: 'ceo',
        name: 'CEO',
        sprite_id: null,
        config: null,
        status: 'idle',
        created_at: 0,
        updated_at: 0,
        added_at: 0,
        added_by_user_id: 'user-1',
      } as any,
    ])
    mockedListLinkedWorkItemsForTicket.mockResolvedValue([])
    mockedListTicketLinksByTicket.mockResolvedValue([])
    mockedCreateOneShotRoutineSchedule.mockResolvedValue({
      routine: { id: 'routine-1' } as any,
      run: { id: 'run-1' } as any,
      scheduledItem: { id: 'scheduled-1' } as any,
    })

    const result = await executeTool(
      'run_ticket_now',
      {
        ticket_id: 'ticket-1',
      },
      {
        ...context,
        jobId: 'job-1',
      }
    )

    expect(result.success).toBe(true)
    expect(mockedCreateOneShotRoutineSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        targetSessionKey: 'app:user-1:proof',
        sourceRef: 'ticket:ticket-1',
      })
    )
    expect(mockedCreateWorkItem).not.toHaveBeenCalled()
    expect(mockedEnqueueToLane).not.toHaveBeenCalled()
    expect(mockedCreateTicketLink).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-1',
        kind: 'external',
        ref: 'scheduled_item:scheduled-1',
      })
    )
    expect(result.output).toContain('scheduled-1')
    expect(result.output).toContain('routine-1')
  })

  it('dedupes a recent ticket run in the same session instead of queueing another echo', async () => {
    mockedFindTicketById.mockResolvedValue({
      id: 'ticket-1',
      goal_id: 'goal-1',
      title: 'Advance the cleanup lane',
      body: 'Pick the next bounded action and leave a receipt.',
      status: 'in_progress',
      assignee_kind: 'agent',
      assignee_ref: 'agent-1',
      claimed_by_kind: 'agent',
      claimed_by_ref: 'agent-1',
      claimed_at: 0,
      archived_at: null,
      created_at: 0,
      updated_at: 0,
    } as Database.Ticket)
    mockedFindAgentById.mockResolvedValue({
      id: 'agent-1',
      handle: 'ceo',
      name: 'CEO',
      sprite_id: null,
      config: null,
      status: 'idle',
      created_at: 0,
      updated_at: 0,
    } as Database.Agent)
    mockedListAppSessionParticipantAgents.mockResolvedValue([
      {
        id: 'agent-1',
        handle: 'ceo',
        name: 'CEO',
        sprite_id: null,
        config: null,
        status: 'idle',
        created_at: 0,
        updated_at: 0,
        added_at: 0,
        added_by_user_id: 'user-1',
      } as any,
    ])
    mockedListLinkedWorkItemsForTicket.mockResolvedValue([
      {
        id: 'work-existing',
        plugin_instance_id: null,
        session_key: 'app:user-1:proof',
        source: 'app_chat',
        source_ref: 'app-agent:agent-1:ticket:ticket-1',
        status: 'DONE',
        title: 'Advance the cleanup lane',
        payload: '{}',
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      } as Database.WorkItem,
    ])

    const result = await executeTool(
      'run_ticket_now',
      {
        ticket_id: 'ticket-1',
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedCreateWorkItem).not.toHaveBeenCalled()
    expect(mockedEnqueueToLane).not.toHaveBeenCalled()
    expect(mockedCreateTicketLink).not.toHaveBeenCalled()
    expect(mockedTouchAppSessionLastActivity).not.toHaveBeenCalled()
    expect(result.output).toContain('Skipped duplicate ticket run')
    expect(result.output).toContain('work-existing')
  })
})
