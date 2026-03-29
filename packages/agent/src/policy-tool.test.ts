import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Database from '@nitejar/database'
import type { ToolContext } from './tools'
import {
  assignRoleTool,
  createRoleTool,
  deleteRoleTool,
  getRoleTool,
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
const mockedReplaceRoleGrants = vi.mocked(Database.replaceRoleGrants)
const mockedReplaceRoleDefaults = vi.mocked(Database.replaceRoleDefaults)

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

  it('creates roles with default values payloads', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedFindRoleBySlug.mockResolvedValue(null)
    mockedCreateRole.mockResolvedValue({
      id: 'role-2',
      slug: 'watcher',
      name: 'Watcher',
      charter: null,
      escalation_posture: null,
      active: 1,
      created_at: 0,
      updated_at: 0,
    })

    const result = await createRoleTool(
      {
        name: 'Watcher',
        slug: 'watcher',
        defaults: [{ key: 'tone', value: { style: 'quiet' } }],
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedReplaceRoleDefaults).toHaveBeenCalledWith('role-2', [
      { key: 'tone', value_json: '{"style":"quiet"}' },
    ])
  })

  it('rejects duplicate roles and invalid grant/default payloads', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedFindRoleBySlug.mockResolvedValue({
      id: 'role-1',
      slug: 'operator',
      name: 'Operator',
      charter: null,
      escalation_posture: null,
      active: 1,
      created_at: 0,
      updated_at: 0,
    })

    const duplicate = await createRoleTool(
      {
        name: 'Operator',
        slug: 'operator',
      },
      context
    )
    expect(duplicate.success).toBe(false)
    expect(duplicate.error).toContain('already exists')

    mockedFindRoleBySlug.mockResolvedValue(null)
    const badGrants = await createRoleTool(
      {
        name: 'Operator',
        slug: 'operator',
        grants: ['oops'],
      },
      context
    )
    expect(badGrants.success).toBe(false)
    expect(badGrants.error).toContain('Each grant must be an object.')

    const badDefaults = await createRoleTool(
      {
        name: 'Operator',
        slug: 'operator',
        defaults: ['oops'],
      },
      context
    )
    expect(badDefaults.success).toBe(false)
    expect(badDefaults.error).toContain('Each default must be an object.')
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

  it('gets role details and safely parses broken defaults', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedFindRoleById.mockResolvedValue({
      id: 'role-1',
      slug: 'ceo',
      name: 'CEO',
      charter: 'Run the company.',
      escalation_posture: 'direct',
      active: 1,
      created_at: 0,
      updated_at: 0,
    })
    mockedListRoleGrants.mockResolvedValue([
      {
        id: 'grant-1',
        role_id: 'role-1',
        action: 'policy.read',
        resource_type: '*',
        resource_id: null,
        created_at: 0,
      },
    ] as never)
    mockedListRoleDefaults.mockResolvedValue([
      {
        id: 'default-1',
        role_id: 'role-1',
        key: 'greeting',
        value_json: '{not-json}',
        created_at: 0,
        updated_at: 0,
      },
    ] as never)

    const result = await getRoleTool({ role_id: 'role-1' }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('"policy.read"')
    expect(result.output).toContain('"{not-json}"')

    const missingId = await getRoleTool({}, context)
    expect(missingId.success).toBe(false)
    expect(missingId.error).toBe('role_id is required.')

    mockedFindRoleById.mockResolvedValue(null)
    const missingRole = await getRoleTool({ role_id: 'role-404' }, context)
    expect(missingRole.success).toBe(false)
    expect(missingRole.error).toBe('Role not found.')
  })

  it('replaces grants/defaults on update and handles missing roles', async () => {
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
        name: 'Chief Exec',
        charter: null,
        escalation_posture: null,
        active: 1,
        created_at: 0,
        updated_at: 1,
      })

    const result = await updateRoleTool(
      {
        role_id: 'role-1',
        name: 'Chief Exec',
        charter: '   ',
        grants: [],
        defaults: [{ key: 'tone', value: { style: 'direct' } }],
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedReplaceRoleGrants).toHaveBeenCalledWith('role-1', [])
    expect(mockedReplaceRoleDefaults).toHaveBeenCalledWith('role-1', [
      { key: 'tone', value_json: '{"style":"direct"}' },
    ])
    expect(result.output).toContain('"Chief Exec"')

    mockedFindRoleById.mockResolvedValue(null)
    const missing = await updateRoleTool({ role_id: 'role-404' }, context)
    expect(missing.success).toBe(false)
    expect(missing.error).toBe('Role not found.')

    const missingId = await updateRoleTool({}, context)
    expect(missingId.success).toBe(false)
    expect(missingId.error).toBe('role_id is required.')
  })

  it('deletes roles only with policy.delete', async () => {
    mockedAssertAgentGrant.mockRejectedValue(new Error('missing policy.delete'))

    const result = await deleteRoleTool({ role_id: 'role-1' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('policy.delete')
  })

  it('blocks deleting assigned roles and deletes unassigned roles', async () => {
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
    mockedGetDb.mockReturnValue({
      fn: {
        countAll: () => ({ as: () => 'count' }),
      },
      selectFrom: () => ({
        select: () => ({
          where: () => ({
            executeTakeFirstOrThrow: vi.fn().mockResolvedValue({ count: 2 }),
          }),
        }),
      }),
      deleteFrom: vi.fn(() => ({
        where: vi.fn(() => ({
          execute: vi.fn().mockResolvedValue(undefined),
        })),
      })),
    } as never)

    const blocked = await deleteRoleTool({ role_id: 'role-1' }, context)
    expect(blocked.success).toBe(false)
    expect(blocked.error).toContain('2 agent(s) currently have this role assigned')

    mockedGetDb.mockReturnValue({
      fn: {
        countAll: () => ({ as: () => 'count' }),
      },
      selectFrom: () => ({
        select: () => ({
          where: () => ({
            executeTakeFirstOrThrow: vi.fn().mockResolvedValue({ count: 0 }),
          }),
        }),
      }),
      deleteFrom: vi.fn(() => ({
        where: vi.fn(() => ({
          execute: vi.fn().mockResolvedValue(undefined),
        })),
      })),
    } as never)

    const deleted = await deleteRoleTool({ role_id: 'role-1' }, context)
    expect(deleted.success).toBe(true)
    expect(deleted.output).toContain('"deleted": true')

    mockedFindRoleById.mockResolvedValue(null)
    const missingRole = await deleteRoleTool({ role_id: 'role-404' }, context)
    expect(missingRole.success).toBe(false)
    expect(missingRole.error).toBe('Role not found.')
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

    const assignResult = await assignRoleTool({ role_id: 'role-1', agent_id: 'agent-2' }, context)
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

  it('handles missing role/agent assignments and failed unassigns', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedFindRoleById.mockResolvedValue(null)

    const noRole = await assignRoleTool({ role_id: 'role-1', agent_id: 'agent-2' }, context)
    expect(noRole.success).toBe(false)
    expect(noRole.error).toBe('Role not found.')

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
    mockedFindAgentById.mockResolvedValue(null)

    const noAgent = await assignRoleTool({ role_id: 'role-1', agent_id: 'agent-2' }, context)
    expect(noAgent.success).toBe(false)
    expect(noAgent.error).toBe('Agent not found.')

    mockedRemoveRoleFromAgent.mockResolvedValue(false)
    const notAssigned = await unassignRoleTool({ role_id: 'role-1', agent_id: 'agent-2' }, context)
    expect(notAssigned.success).toBe(false)
    expect(notAssigned.error).toBe('Agent did not have this role assigned.')
  })

  it('surfaces required-id and grant failures for assign and unassign', async () => {
    await expect(assignRoleTool({}, context)).resolves.toEqual({
      success: false,
      error: 'role_id is required.',
    })
    await expect(unassignRoleTool({}, context)).resolves.toEqual({
      success: false,
      error: 'role_id is required.',
    })

    mockedAssertAgentGrant.mockRejectedValue(new Error('missing policy.write'))
    const deniedAssign = await assignRoleTool({ role_id: 'role-1', agent_id: 'agent-2' }, context)
    expect(deniedAssign.success).toBe(false)
    expect(deniedAssign.error).toContain('missing policy.write')

    const deniedUnassign = await unassignRoleTool(
      { role_id: 'role-1', agent_id: 'agent-2' },
      context
    )
    expect(deniedUnassign.success).toBe(false)
    expect(deniedUnassign.error).toContain('missing policy.write')
  })
})
