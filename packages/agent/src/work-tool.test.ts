import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolContext } from './tools'
import * as Database from '@nitejar/database'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    assertAgentGrant: vi.fn(),
    createWorkUpdate: vi.fn(),
    getDb: vi.fn(() => ({
      selectFrom: () => ({
        select: () => ({
          where: () => ({
            executeTakeFirst: vi.fn().mockResolvedValue(null),
          }),
        }),
      }),
    })),
    listGoals: vi.fn(),
    listTickets: vi.fn(),
    findGoalById: vi.fn(),
  }
})

const mockedListGoals = vi.mocked(Database.listGoals)
const mockedListTickets = vi.mocked(Database.listTickets)
const mockedFindGoalById = vi.mocked(Database.findGoalById)
const mockedCreateWorkUpdate = vi.mocked(Database.createWorkUpdate)

const context: ToolContext = {
  agentId: 'agent-1',
  cwd: '/workspace',
  spriteName: 'home',
}

describe('work tools', () => {
  beforeEach(() => {
    mockedListGoals.mockReset()
    mockedListTickets.mockReset()
    mockedFindGoalById.mockReset()
    mockedCreateWorkUpdate.mockReset()
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

  it('rejects team-scoped heartbeat updates for post_work_update', async () => {
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
    expect(result.error).toContain('Heartbeat updates must target a goal')
    expect(mockedCreateWorkUpdate).not.toHaveBeenCalled()
  })
})
