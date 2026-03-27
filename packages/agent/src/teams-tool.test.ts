import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Database from '@nitejar/database'
import type { ToolContext } from './tools'
import {
  createTeamTool,
  deleteTeamTool,
  listTeamsTool,
  updateTeamTool,
} from './tools/handlers/teams'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    assertAgentGrant: vi.fn(),
    getDb: vi.fn(),
    findTeamById: vi.fn(),
    createTeam: vi.fn(),
    updateTeam: vi.fn(),
    addAgentToTeam: vi.fn(),
    removeAgentFromTeam: vi.fn(),
    deleteTeam: vi.fn(),
  }
})

const mockedAssertAgentGrant = vi.mocked(Database.assertAgentGrant)
const mockedGetDb = vi.mocked(Database.getDb)
const mockedFindTeamById = vi.mocked(Database.findTeamById)
const mockedCreateTeam = vi.mocked(Database.createTeam)
const mockedUpdateTeam = vi.mocked(Database.updateTeam)
const mockedDeleteTeam = vi.mocked(Database.deleteTeam)

const context: ToolContext = {
  agentId: 'agent-1',
  spriteName: 'nitejar-agent-1',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('team tools', () => {
  it('rejects list_teams when company.team.read is denied', async () => {
    mockedAssertAgentGrant.mockRejectedValue(new Error('missing company.team.read'))

    const result = await listTeamsTool({}, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('company.team.read')
  })

  it('lists teams when company.team.read is granted', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    const execute = vi.fn().mockResolvedValue([
      {
        id: 'team-1',
        name: 'Ops',
        charter: null,
        slug: 'ops',
        parent_team_id: null,
        lead_kind: null,
        lead_ref: null,
      },
    ])
    const secondOrderBy = vi.fn(() => ({ execute }))
    const firstOrderBy = vi.fn(() => ({ orderBy: secondOrderBy }))
    const selectAll = vi.fn(() => ({ orderBy: firstOrderBy }))
    mockedGetDb.mockReturnValue({
      selectFrom: vi.fn(() => ({
        selectAll,
      })),
    } as never)

    const result = await listTeamsTool({}, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('"Ops"')
  })

  it('creates teams with company.team.create', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedCreateTeam.mockResolvedValue({
      id: 'team-1',
      name: 'Ops',
      charter: 'Run ops.',
      slug: 'ops',
      parent_team_id: null,
      lead_kind: null,
      lead_ref: null,
      sort_order: 0,
      created_at: 0,
      updated_at: 0,
    })

    const result = await createTeamTool({ name: 'Ops', charter: 'Run ops.' }, context)

    expect(result.success).toBe(true)
    expect(mockedAssertAgentGrant).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'company.team.create' })
    )
    expect(mockedCreateTeam).toHaveBeenCalled()
  })

  it('updates and deletes teams with write/delete grants', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedFindTeamById.mockResolvedValue({
      id: 'team-1',
      name: 'Ops',
      charter: null,
      slug: 'ops',
      parent_team_id: null,
      lead_kind: null,
      lead_ref: null,
      sort_order: 0,
      created_at: 0,
      updated_at: 0,
    })
    mockedUpdateTeam.mockResolvedValue({
      id: 'team-1',
      name: 'Operations',
      charter: null,
      slug: 'ops',
      parent_team_id: null,
      lead_kind: null,
      lead_ref: null,
      sort_order: 0,
      created_at: 0,
      updated_at: 0,
    })
    mockedDeleteTeam.mockResolvedValue(true)
    mockedGetDb.mockReturnValue({
      selectFrom: vi.fn(() => ({
        select: vi.fn(() => ({
          where: vi.fn(() => ({
            executeTakeFirst: vi.fn().mockResolvedValue(undefined),
          })),
        })),
      })),
    } as never)

    const updateResult = await updateTeamTool(
      { team_id: 'team-1', name: 'Operations' },
      context
    )
    const deleteResult = await deleteTeamTool({ team_id: 'team-1' }, context)

    expect(updateResult.success).toBe(true)
    expect(deleteResult.success).toBe(true)
    expect(mockedAssertAgentGrant).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'company.team.write' })
    )
    expect(mockedAssertAgentGrant).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'company.team.delete' })
    )
  })
})
