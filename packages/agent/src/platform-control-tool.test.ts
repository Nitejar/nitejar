import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, AgentSandbox } from '@nitejar/database'
import * as Database from '@nitejar/database'
import type { ToolContext } from './tools'
import {
  createAgentTool,
  getAgentConfigTool,
  getPluginInstanceTool,
  listAgentsTool,
  listPluginInstancesTool,
  setPluginInstanceAgentAssignmentTool,
  setAgentStatusTool,
} from './tools/handlers/platform-control'
import { pluginHandlerRegistry } from '@nitejar/plugin-handlers/registry'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    assertAgentGrant: vi.fn(),
    findAgentById: vi.fn(),
    findPluginInstanceById: vi.fn(),
    getPluginInstancesForAgent: vi.fn(),
    listAgentIdsForPluginInstance: vi.fn(),
    listAgents: vi.fn(),
    listPluginInstancesWithAgents: vi.fn(),
    findAgentByHandle: vi.fn(),
    createAgent: vi.fn(),
    createAgentSandbox: vi.fn(),
    getAgentPluginInstanceAssignment: vi.fn(),
    setAgentPluginInstanceAssignment: vi.fn(),
    updateAgent: vi.fn(),
  }
})

const mockedAssertAgentGrant = vi.mocked(Database.assertAgentGrant)
const mockedFindAgentById = vi.mocked(Database.findAgentById)
const mockedFindPluginInstanceById = vi.mocked(Database.findPluginInstanceById)
const mockedGetPluginInstancesForAgent = vi.mocked(Database.getPluginInstancesForAgent)
const mockedListAgentIdsForPluginInstance = vi.mocked(Database.listAgentIdsForPluginInstance)
const mockedListAgents = vi.mocked(Database.listAgents)
const mockedListPluginInstancesWithAgents = vi.mocked(Database.listPluginInstancesWithAgents)
const mockedFindAgentByHandle = vi.mocked(Database.findAgentByHandle)
const mockedCreateAgent = vi.mocked(Database.createAgent)
const mockedCreateAgentSandbox = vi.mocked(Database.createAgentSandbox)
const mockedGetAgentPluginInstanceAssignment = vi.mocked(Database.getAgentPluginInstanceAssignment)
const mockedSetAgentPluginInstanceAssignment = vi.mocked(Database.setAgentPluginInstanceAssignment)
const mockedUpdateAgent = vi.mocked(Database.updateAgent)

const baseContext: ToolContext = {
  spriteName: 'nitejar-agent-1',
  agentId: 'agent-1',
}

function agent(overrides: Partial<Agent> = {}, config: Record<string, unknown> = {}): Agent {
  return {
    id: overrides.id ?? 'agent-1',
    handle: overrides.handle ?? 'agent-1',
    name: overrides.name ?? 'Agent One',
    sprite_id: overrides.sprite_id ?? null,
    config: overrides.config ?? JSON.stringify(config),
    status: overrides.status ?? 'idle',
    created_at: overrides.created_at ?? 0,
    updated_at: overrides.updated_at ?? 0,
  }
}

function sandbox(overrides: Partial<AgentSandbox> = {}): AgentSandbox {
  return {
    id: 'sandbox-1',
    agent_id: 'agent-2',
    name: 'home',
    description: 'Persistent home sandbox',
    sprite_name: 'nitejar-agent-2',
    kind: 'home',
    created_by: 'agent',
    created_at: 0,
    updated_at: 0,
    last_used_at: 0,
    ...overrides,
  }
}

beforeEach(() => {
  mockedAssertAgentGrant.mockReset()
  mockedFindAgentById.mockReset()
  mockedFindPluginInstanceById.mockReset()
  mockedGetPluginInstancesForAgent.mockReset()
  mockedListAgentIdsForPluginInstance.mockReset()
  mockedListAgents.mockReset()
  mockedListPluginInstancesWithAgents.mockReset()
  mockedFindAgentByHandle.mockReset()
  mockedCreateAgent.mockReset()
  mockedCreateAgentSandbox.mockReset()
  mockedGetAgentPluginInstanceAssignment.mockReset()
  mockedSetAgentPluginInstanceAssignment.mockReset()
  mockedUpdateAgent.mockReset()
  pluginHandlerRegistry.unregister('github')
})

describe('platform control tools', () => {
  it('rejects list_agents when fleet.agent.read is denied', async () => {
    mockedAssertAgentGrant.mockRejectedValue(new Error('platform control disabled'))

    const result = await listAgentsTool({}, baseContext)

    expect(result.success).toBe(false)
    expect(result.error).toContain('disabled')
    expect(mockedListAgents).not.toHaveBeenCalled()
  })

  it('lists agents when fleet.agent.read is granted', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedListAgents.mockResolvedValue([
      agent({ id: 'agent-1', handle: 'alpha', name: 'Alpha' }, { title: 'Ops' }),
      agent({ id: 'agent-2', handle: 'beta', name: 'Beta' }, { title: 'QA' }),
    ])

    const result = await listAgentsTool({}, baseContext)

    expect(result.success).toBe(true)
    expect(result.output).toContain('"agents"')
    expect(result.output).toContain('"alpha"')
    expect(result.output).toContain('"beta"')
  })

  it('includes assigned plugin instances in get_agent_config', async () => {
    mockedAssertAgentGrant
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
    mockedFindAgentById.mockResolvedValue(
      agent({ id: 'agent-2', handle: 'builder', name: 'Builder' }, { title: 'Builder' })
    )
    mockedGetPluginInstancesForAgent.mockResolvedValue([
      { id: 'plugin-1', name: 'Nitejar GitHub', type: 'github', enabled: 1 },
    ])

    const result = await getAgentConfigTool({ agent_id: 'agent-2' }, baseContext)

    expect(result.success).toBe(true)
    expect(result.output).toContain('"pluginInstances"')
    expect(result.output).toContain('"Nitejar GitHub"')
  })

  it('omits plugin instances from get_agent_config without plugin read access', async () => {
    mockedAssertAgentGrant
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('plugin visibility disabled'))
    mockedFindAgentById.mockResolvedValue(
      agent({ id: 'agent-2', handle: 'builder', name: 'Builder' }, { title: 'Builder' })
    )

    const result = await getAgentConfigTool({ agent_id: 'agent-2' }, baseContext)

    expect(result.success).toBe(true)
    expect(result.output).not.toContain('"pluginInstances"')
    expect(mockedGetPluginInstancesForAgent).not.toHaveBeenCalled()
  })

  it('lists plugin instances with assigned agents', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedListPluginInstancesWithAgents.mockResolvedValue([
      {
        id: 'plugin-1',
        plugin_id: 'builtin.github',
        type: 'github',
        name: 'Nitejar GitHub',
        config: '{}',
        config_json: '{}',
        enabled: 1,
        scope: 'global',
        created_at: 0,
        updated_at: 0,
        agents: [{ id: 'agent-2', name: 'Builder' }],
      },
    ])

    const result = await listPluginInstancesTool({}, baseContext)

    expect(result.success).toBe(true)
    expect(result.output).toContain('"pluginInstances"')
    expect(result.output).toContain('"Builder"')
  })

  it('shows redacted plugin config and assignments for get_plugin_instance', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedFindPluginInstanceById.mockResolvedValue({
      id: 'plugin-1',
      plugin_id: 'builtin.github',
      type: 'github',
      name: 'Nitejar GitHub',
      config: JSON.stringify({ appId: '123', clientSecret: 'enc:abc' }),
      config_json: JSON.stringify({ appId: '123', clientSecret: 'enc:abc' }),
      enabled: 1,
      scope: 'global',
      created_at: 0,
      updated_at: 0,
    })
    mockedListAgentIdsForPluginInstance.mockResolvedValue(['agent-1', 'agent-2'])
    pluginHandlerRegistry.register({
      type: 'github',
      displayName: 'GitHub',
      description: 'GitHub integration',
      icon: 'brand-github',
      category: 'code',
      sensitiveFields: ['clientSecret'],
      validateConfig: () => ({ valid: true, errors: [] }),
      parseWebhook: () => Promise.resolve({ shouldProcess: false }),
      postResponse: () => Promise.resolve({ success: true }),
    })

    const result = await getPluginInstanceTool({ plugin_instance_id: 'plugin-1' }, baseContext)

    expect(result.success).toBe(true)
    expect(result.output).toContain('"assignedAgentIds"')
    expect(result.output).toContain('••••••••')
  })

  it('updates agent status in dangerous mode', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedUpdateAgent.mockResolvedValue(agent({ id: 'agent-2', status: 'offline' }))

    const result = await setAgentStatusTool(
      {
        agent_id: 'agent-2',
        status: 'offline',
      },
      baseContext
    )

    expect(result.success).toBe(true)
    expect(mockedUpdateAgent).toHaveBeenCalledWith('agent-2', { status: 'offline' })
    expect(result.output).toContain('"offline"')
  })

  it('assigns an agent to a plugin instance', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedFindPluginInstanceById.mockResolvedValue({
      id: 'plugin-1',
      plugin_id: 'builtin.github',
      type: 'github',
      name: 'Nitejar GitHub',
      config: null,
      config_json: null,
      enabled: 1,
      scope: 'global',
      created_at: 0,
      updated_at: 0,
    })
    mockedFindAgentById.mockResolvedValue(agent({ id: 'agent-2', handle: 'builder' }))
    mockedGetAgentPluginInstanceAssignment.mockResolvedValue({
      plugin_instance_id: 'plugin-1',
      agent_id: 'agent-2',
      created_at: 0,
      policy_json: JSON.stringify({ mode: 'allow_list', allowedActions: ['issues.read'] }),
    })

    const result = await setPluginInstanceAgentAssignmentTool(
      {
        plugin_instance_id: 'plugin-1',
        agent_id: 'agent-2',
        enabled: true,
        policy: { mode: 'allow_list', allowedActions: ['issues.read'] },
      },
      baseContext
    )

    expect(result.success).toBe(true)
    expect(mockedSetAgentPluginInstanceAssignment).toHaveBeenCalledWith({
      pluginInstanceId: 'plugin-1',
      agentId: 'agent-2',
      enabled: true,
      policyJson: JSON.stringify({ mode: 'allow_list', allowedActions: ['issues.read'] }),
    })
    expect(result.output).toContain('"ok"')
    expect(result.output).toContain('"issues.read"')
  })

  it('creates an agent and home sandbox in dangerous mode', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedFindAgentByHandle.mockResolvedValue(null)
    mockedCreateAgent.mockResolvedValue(
      agent({ id: 'agent-2', handle: 'builder', name: 'Builder' }, { title: 'Builder' })
    )
    mockedCreateAgentSandbox.mockResolvedValue(sandbox({ agent_id: 'agent-2' }))

    const result = await createAgentTool(
      {
        handle: 'builder',
        name: 'Builder',
      },
      baseContext
    )

    expect(result.success).toBe(true)
    expect(mockedCreateAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: 'builder',
        name: 'Builder',
        status: 'idle',
      })
    )
    expect(mockedCreateAgentSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'agent-2',
        name: 'home',
        kind: 'home',
      })
    )
  })
})
