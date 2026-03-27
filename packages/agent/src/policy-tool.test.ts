import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Database from '@nitejar/database'
import type { ToolContext } from './tools'
import {
  assignRoleTool,
  createRoleTool,
  deleteRoleTool,
  listRolesTool,
  unassignRoleTool,
  updateRoleTool,
} from './tools/handlers/policy'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    assertAgentGrant: vi.fn(),
    listRoles: vi.fn(),
    listRoleGrants: vi.fn(),
    listRoleDefaults: vi.fn(),
    replaceRoleGrants: vi.fn(),
    replaceRoleDefaults: vi.fn(),
    findRoleBySlug: vi.fn(),
    createRole: vi.fn(),
    findRoleById: vi.fn(),
    updateRole: vi.fn(),
    findAgentById: vi.fn(),
    assignRoleToAgent: vi.fn(),
    removeRoleFromAgent: vi.fn(),
    getDb: vi.fn(),
  }
})

const mockedAssertAgentGrant = vi.mocked(Database.assertAgentGrant)
const mockedListRoles = vi.mocked(Database.listRoles)
const mockedListRoleGrants = vi.mocked(Database.listRoleGrants)
const mockedListRoleDefaults = vi.mocked(Database.listRoleDefaults)
const mockedFindRoleBySlug = vi.mocked(Database.findRoleBySlug)
const mockedCreateRole = vi.mocked(Database.createRole)
const mockedFindRoleById = vi.mocked(Database.findRoleById)
const mockedUpdateRole = vi.mocked(Database.updateRole)
const mockedFindAgentById = vi.mocked(Database.findAgentById)
const mockedAssignRoleToAgent = vi.mocked(Database.assignRoleToAgent)
const mockedRemoveRoleFromAgent = vi.mocked(Database.removeRoleFromAgent)
const mockedGetDb = vi.mocked(Database.getDb)

const context: ToolContext = {
  agentId: 'agent-1',
  spriteName: 'nitejar-agent-1',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('policy tools', () => {
  it('rejects list_roles when policy.read is denied', async () => {
    mockedAssertAgentGrant.mockRejectedValue(new Error('missing policy.read'))

    const result = await listRolesTool({}, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('policy.read')
  })

  it('lists roles when policy.read is granted', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedListRoles.mockResolvedValue([
      {
        id: 'role-1',
        slug: 'operator',
        name: 'Operator',
        charter: null,
        escalation_posture: null,
        active: 1,
        created_at: 0,
        updated_at: 0,
      },
    ])
    mockedListRoleGrants.mockResolvedValue([])
    mockedListRoleDefaults.mockResolvedValue([])

    const result = await listRolesTool({}, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('"operator"')
  })

  it('creates roles when policy.create is granted', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedFindRoleBySlug.mockResolvedValue(null)
    mockedCreateRole.mockResolvedValue({
      id: 'role-1',
      slug: 'operator',
      name: 'Operator',
      charter: null,
      escalation_posture: null,
      active: 1,
      created_at: 0,
      updated_at: 0,
    })

    const result = await createRoleTool(
      {
        name: 'Operator',
        slug: 'operator',
        charter: 'Keep the company moving.',
        grants: [{ action: 'policy.read', resourceType: '*' }],
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedAssertAgentGrant).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'policy.create' })
    )
    expect(mockedCreateRole).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Operator',
        slug: 'operator',
        charter: 'Keep the company moving.',
      })
    )
  })

  it('updates role charter with policy.write', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedFindRoleById
      .mockResolvedValueOnce({
        id: 'role-1',
        slug: 'ceo',
        name: 'CEO',
        charter: 'Run the company.',
        escalation_posture: null,
        active: 1,
        created_at: 0,
        updated_at: 0,
      })
      .mockResolvedValueOnce({
        id: 'role-1',
        slug: 'ceo',
        name: 'CEO',
        charter: 'Autonomously move Nitejar forward and avoid loops.',
        escalation_posture: null,
        active: 1,
        created_at: 0,
        updated_at: 1,
      })
    mockedUpdateRole.mockResolvedValue({
      id: 'role-1',
      slug: 'ceo',
      name: 'CEO',
      charter: 'Autonomously move Nitejar forward and avoid loops.',
      escalation_posture: null,
      active: 1,
      created_at: 0,
      updated_at: 1,
    })

    const result = await updateRoleTool(
      {
        role_id: 'role-1',
        charter: 'Autonomously move Nitejar forward and avoid loops.',
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedAssertAgentGrant).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'policy.write', resourceId: 'role-1' })
    )
    expect(mockedUpdateRole).toHaveBeenCalledWith('role-1', {
      charter: 'Autonomously move Nitejar forward and avoid loops.',
    })
    expect(result.output).toContain('Autonomously move Nitejar forward and avoid loops.')
  })

  it('deletes roles only with policy.delete', async () => {
    mockedAssertAgentGrant.mockRejectedValue(new Error('missing policy.delete'))

    const result = await deleteRoleTool({ role_id: 'role-1' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('policy.delete')
  })

  it('assigns and unassigns roles with policy.write', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedFindRoleById.mockResolvedValue({
      id: 'role-1',
      slug: 'operator',
      name: 'Operator',
      charter: null,
      escalation_posture: null,
      active: 1,
      created_at: 0,
      updated_at: 0,
    })
    mockedFindAgentById.mockResolvedValue({
      id: 'agent-2',
      handle: 'agent-two',
      name: 'Agent Two',
      sprite_id: null,
      config: null,
      status: 'idle',
      created_at: 0,
      updated_at: 0,
    })
    mockedAssignRoleToAgent.mockResolvedValue(undefined)
    mockedRemoveRoleFromAgent.mockResolvedValue(true)
    mockedGetDb.mockReturnValue({
      selectFrom: vi.fn(() => ({
        select: vi.fn(() => ({
          where: vi.fn(() => ({
            executeTakeFirstOrThrow: vi.fn().mockResolvedValue({ count: 0 }),
          })),
        })),
      })),
      deleteFrom: vi.fn(() => ({
        where: vi.fn(() => ({
          execute: vi.fn().mockResolvedValue(undefined),
        })),
      })),
    } as never)

    const assignResult = await assignRoleTool(
      { role_id: 'role-1', agent_id: 'agent-2' },
      context
    )
    const unassignResult = await unassignRoleTool(
      { role_id: 'role-1', agent_id: 'agent-2' },
      context
    )

    expect(assignResult.success).toBe(true)
    expect(unassignResult.success).toBe(true)
    expect(mockedAssertAgentGrant).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'policy.write' })
    )
  })
})
