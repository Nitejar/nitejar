import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockedRegistryGet } = vi.hoisted(() => ({
  mockedRegistryGet: vi.fn(),
}))

vi.mock('@nitejar/database', () => ({
  searchPluginInstances: vi.fn(),
  listAgentAssignmentsForPluginInstances: vi.fn(),
  findPluginInstanceById: vi.fn(),
  listAgentIdsForPluginInstance: vi.fn(),
  updatePluginInstance: vi.fn(),
  findAgentById: vi.fn(),
  getAgentPluginInstanceAssignment: vi.fn(),
  setAgentPluginInstanceAssignment: vi.fn(),
}))

vi.mock('@nitejar/plugin-handlers', () => ({
  pluginHandlerRegistry: {
    get: mockedRegistryGet,
  },
}))

import {
  findAgentById,
  findPluginInstanceById,
  getAgentPluginInstanceAssignment,
  listAgentAssignmentsForPluginInstances,
  listAgentIdsForPluginInstance,
  searchPluginInstances,
  setAgentPluginInstanceAssignment,
  updatePluginInstance,
} from '@nitejar/database'
import {
  getPluginInstanceOp,
  listPluginInstancesOp,
  setPluginInstanceAgentAssignmentOp,
  setPluginInstanceEnabledOp,
} from './plugin-instances'

const mockedSearchPluginInstances = vi.mocked(searchPluginInstances)
const mockedListAssignments = vi.mocked(listAgentAssignmentsForPluginInstances)
const mockedFindPluginInstanceById = vi.mocked(findPluginInstanceById)
const mockedListAgentIdsForPluginInstance = vi.mocked(listAgentIdsForPluginInstance)
const mockedUpdatePluginInstance = vi.mocked(updatePluginInstance)
const mockedFindAgentById = vi.mocked(findAgentById)
const mockedGetAgentPluginInstanceAssignment = vi.mocked(getAgentPluginInstanceAssignment)
const mockedSetAgentPluginInstanceAssignment = vi.mocked(setAgentPluginInstanceAssignment)

describe('plugin instances ops', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetAgentPluginInstanceAssignment.mockResolvedValue(null)
  })

  it('lists plugin instances with cursor contract and assignments', async () => {
    mockedSearchPluginInstances.mockResolvedValue({
      pluginInstances: [
        {
          id: 'int-1',
          plugin_id: 'builtin.telegram',
          type: 'telegram',
          name: 'Main',
          config: null,
          config_json: null,
          scope: 'global',
          enabled: 1,
          created_at: 100,
          updated_at: 100,
        },
      ],
      integrations: [
        {
          id: 'int-1',
          plugin_id: 'builtin.telegram',
          type: 'telegram',
          name: 'Main',
          config: null,
          config_json: null,
          scope: 'global',
          enabled: 1,
          created_at: 100,
          updated_at: 100,
        },
      ],
      plugin_instances: [
        {
          id: 'int-1',
          plugin_id: 'builtin.telegram',
          type: 'telegram',
          name: 'Main',
          config: null,
          config_json: null,
          scope: 'global',
          enabled: 1,
          created_at: 100,
          updated_at: 100,
        },
      ],
      nextCursor: { createdAt: 90, id: 'int-0' },
    })
    mockedListAssignments.mockResolvedValue([
      { pluginInstanceId: 'int-1', agentId: 'a-1', agentName: 'Alpha' },
    ])

    const cursor = Buffer.from(JSON.stringify({ createdAt: 120, id: 'int-9' }), 'utf8').toString(
      'base64url'
    )
    const result = await listPluginInstancesOp({ cursor, limit: 10 })

    expect(mockedSearchPluginInstances).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { createdAt: 120, id: 'int-9' }, limit: 10 })
    )
    expect(result.pluginInstances[0]?.agents).toEqual([{ id: 'a-1', name: 'Alpha' }])
    expect(result.nextCursor).toBe(
      Buffer.from(JSON.stringify({ createdAt: 90, id: 'int-0' }), 'utf8').toString('base64url')
    )
  })

  it('redacts sensitive plugin instance config fields', async () => {
    mockedFindPluginInstanceById.mockResolvedValue({
      id: 'int-1',
      plugin_id: 'builtin.telegram',
      type: 'telegram',
      name: 'Main',
      config: JSON.stringify({
        botToken: 'abc',
        webhookSecret: 'enc:xyz',
        nested: { botToken: 'q' },
      }),
      config_json: JSON.stringify({
        botToken: 'abc',
        webhookSecret: 'enc:xyz',
        nested: { botToken: 'q' },
      }),
      scope: 'global',
      enabled: 1,
      created_at: 100,
      updated_at: 100,
    })
    mockedListAgentIdsForPluginInstance.mockResolvedValue(['a-1'])
    mockedRegistryGet.mockReturnValue({ sensitiveFields: ['botToken', 'webhookSecret'] } as never)

    const result = await getPluginInstanceOp({ pluginInstanceId: 'int-1' })
    const config = result.pluginInstance.config as Record<string, unknown>

    expect(config.botToken).toBe('••••••••')
    expect(config.webhookSecret).toBe('••••••••')
    expect((config.nested as Record<string, unknown>).botToken).toBe('••••••••')
  })

  it('updates enabled state and assignments through shared ops', async () => {
    mockedFindPluginInstanceById.mockResolvedValue({
      id: 'int-1',
      plugin_id: 'builtin.telegram',
      type: 'telegram',
      name: 'Main',
      config: null,
      config_json: null,
      scope: 'global',
      enabled: 1,
      created_at: 100,
      updated_at: 100,
    })
    mockedUpdatePluginInstance.mockResolvedValue({
      id: 'int-1',
      plugin_id: 'builtin.telegram',
      type: 'telegram',
      name: 'Main',
      config: null,
      config_json: null,
      scope: 'global',
      enabled: 0,
      created_at: 100,
      updated_at: 200,
    })
    mockedFindAgentById.mockResolvedValue({ id: 'a-1' } as never)

    const enabledResult = await setPluginInstanceEnabledOp({
      pluginInstanceId: 'int-1',
      enabled: false,
    })
    expect(enabledResult.enabled).toBe(false)

    await setPluginInstanceAgentAssignmentOp({
      pluginInstanceId: 'int-1',
      agentId: 'a-1',
      enabled: true,
    })
    expect(mockedSetAgentPluginInstanceAssignment).toHaveBeenCalledWith({
      pluginInstanceId: 'int-1',
      agentId: 'a-1',
      enabled: true,
    })
  })

  it('persists assignment policy JSON when provided', async () => {
    mockedFindPluginInstanceById.mockResolvedValue({
      id: 'int-1',
      plugin_id: 'builtin.slack',
      type: 'slack',
      name: 'Slack',
      config: null,
      config_json: null,
      scope: 'global',
      enabled: 1,
      created_at: 100,
      updated_at: 100,
    })
    mockedFindAgentById.mockResolvedValue({ id: 'a-1' } as never)
    mockedGetAgentPluginInstanceAssignment.mockResolvedValue({
      agent_id: 'a-1',
      plugin_instance_id: 'int-1',
      created_at: 123,
      policy_json: JSON.stringify({
        mode: 'allow_list',
        allowedActions: ['read_thread'],
      }),
    })

    const result = await setPluginInstanceAgentAssignmentOp({
      pluginInstanceId: 'int-1',
      agentId: 'a-1',
      enabled: true,
      policy: {
        mode: 'allow_list',
        allowedActions: ['read_thread'],
      },
    })

    expect(mockedSetAgentPluginInstanceAssignment).toHaveBeenCalledWith({
      pluginInstanceId: 'int-1',
      agentId: 'a-1',
      enabled: true,
      policyJson: JSON.stringify({
        mode: 'allow_list',
        allowedActions: ['read_thread'],
      }),
    })
    expect(result.policy).toEqual({
      mode: 'allow_list',
      allowedActions: ['read_thread'],
    })
  })
})
