import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, AgentSandbox } from '@nitejar/database'
import * as Database from '@nitejar/database'
import type { ToolContext } from './tools'
import {
  createAgentTool,
  listAgentsTool,
  setAgentStatusTool,
} from './tools/handlers/platform-control'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    findAgentById: vi.fn(),
    listAgents: vi.fn(),
    findAgentByHandle: vi.fn(),
    createAgent: vi.fn(),
    createAgentSandbox: vi.fn(),
    updateAgent: vi.fn(),
  }
})

const mockedFindAgentById = vi.mocked(Database.findAgentById)
const mockedListAgents = vi.mocked(Database.listAgents)
const mockedFindAgentByHandle = vi.mocked(Database.findAgentByHandle)
const mockedCreateAgent = vi.mocked(Database.createAgent)
const mockedCreateAgentSandbox = vi.mocked(Database.createAgentSandbox)
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
  mockedFindAgentById.mockReset()
  mockedListAgents.mockReset()
  mockedFindAgentByHandle.mockReset()
  mockedCreateAgent.mockReset()
  mockedCreateAgentSandbox.mockReset()
  mockedUpdateAgent.mockReset()
})

describe('platform control tools', () => {
  it('rejects list_agents when dangerouslyUnrestricted is disabled', async () => {
    mockedFindAgentById.mockResolvedValue(agent({}, { dangerouslyUnrestricted: false }))

    const result = await listAgentsTool({}, baseContext)

    expect(result.success).toBe(false)
    expect(result.error).toContain('disabled')
    expect(mockedListAgents).not.toHaveBeenCalled()
  })

  it('lists agents when dangerouslyUnrestricted is enabled', async () => {
    mockedFindAgentById.mockResolvedValue(agent({}, { dangerouslyUnrestricted: true }))
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

  it('updates agent status in dangerous mode', async () => {
    mockedFindAgentById.mockResolvedValue(agent({}, { dangerouslyUnrestricted: true }))
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

  it('creates an agent and home sandbox in dangerous mode', async () => {
    mockedFindAgentById.mockResolvedValue(agent({}, { dangerouslyUnrestricted: true }))
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
