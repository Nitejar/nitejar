import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, AgentSandbox } from '@nitejar/database'
import type { ToolContext } from './tools'
import * as Database from '@nitejar/database'
import * as Sandboxes from './sandboxes'
import {
  createEphemeralSandboxTool,
  deleteSandboxTool,
  switchSandboxTool,
} from './tools/handlers/sandboxes'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    findAgentById: vi.fn(),
  }
})

vi.mock('./sandboxes', async () => {
  const actual = await vi.importActual<typeof Sandboxes>('./sandboxes')
  return {
    ...actual,
    createEphemeralSandboxForAgent: vi.fn(),
    deleteAgentSandboxByName: vi.fn(),
    resolveAgentSandboxByName: vi.fn(),
  }
})

const mockedFindAgentById = vi.mocked(Database.findAgentById)
const mockedCreateEphemeralSandboxForAgent = vi.mocked(Sandboxes.createEphemeralSandboxForAgent)
const mockedDeleteAgentSandboxByName = vi.mocked(Sandboxes.deleteAgentSandboxByName)
const mockedResolveAgentSandboxByName = vi.mocked(Sandboxes.resolveAgentSandboxByName)

const baseContext: ToolContext = {
  spriteName: 'nitejar-agent-1',
  activeSandboxName: 'home',
  agentId: 'agent-1',
}

const baseAgent: Agent = {
  id: 'agent-1',
  handle: 'agent',
  name: 'Agent One',
  sprite_id: 'nitejar-agent-1',
  config: JSON.stringify({}),
  status: 'idle',
  created_at: 0,
  updated_at: 0,
}

function sandbox(overrides: Partial<AgentSandbox> = {}): AgentSandbox {
  return {
    id: 'sb-1',
    agent_id: 'agent-1',
    name: 'task-1',
    description: 'Task sandbox',
    sprite_name: 'nitejar-agent-1-ephem-task-1',
    kind: 'ephemeral',
    created_by: 'agent',
    created_at: 0,
    updated_at: 0,
    last_used_at: 0,
    ...overrides,
  }
}

beforeEach(() => {
  mockedFindAgentById.mockReset()
  mockedCreateEphemeralSandboxForAgent.mockReset()
  mockedDeleteAgentSandboxByName.mockReset()
  mockedResolveAgentSandboxByName.mockReset()
})

describe('createEphemeralSandboxTool', () => {
  it('rejects creation when ephemeral policy is disabled', async () => {
    mockedFindAgentById.mockResolvedValue(baseAgent)

    const result = await createEphemeralSandboxTool(
      { name: 'task-1', description: 'Sandbox for task' },
      baseContext
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('disabled')
    expect(mockedCreateEphemeralSandboxForAgent).not.toHaveBeenCalled()
  })

  it('creates and switches by default when policy is enabled', async () => {
    mockedFindAgentById.mockResolvedValue({
      ...baseAgent,
      config: JSON.stringify({ allowEphemeralSandboxCreation: true }),
    })
    mockedCreateEphemeralSandboxForAgent.mockResolvedValue(sandbox())

    const result = await createEphemeralSandboxTool(
      { name: 'task-1', description: 'Sandbox for task' },
      baseContext
    )

    expect(result.success).toBe(true)
    expect(result._meta?.sandboxSwitch).toEqual({
      sandboxName: 'task-1',
      spriteName: 'nitejar-agent-1-ephem-task-1',
    })
  })

  it('creates without switching when switch_to=false', async () => {
    mockedFindAgentById.mockResolvedValue({
      ...baseAgent,
      config: JSON.stringify({ allowEphemeralSandboxCreation: true }),
    })
    mockedCreateEphemeralSandboxForAgent.mockResolvedValue(sandbox())

    const result = await createEphemeralSandboxTool(
      { name: 'task-1', description: 'Sandbox for task', switch_to: false },
      baseContext
    )

    expect(result.success).toBe(true)
    expect(result._meta?.sandboxSwitch).toBeUndefined()
  })
})

describe('switchSandboxTool', () => {
  it('returns not found when sandbox does not exist', async () => {
    mockedResolveAgentSandboxByName.mockResolvedValue(null)

    const result = await switchSandboxTool({ sandbox_name: 'missing' }, baseContext)

    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('deleteSandboxTool', () => {
  it('returns to home when deleting currently active sandbox', async () => {
    mockedDeleteAgentSandboxByName.mockResolvedValue(sandbox({ name: 'task-1' }))
    mockedResolveAgentSandboxByName.mockResolvedValue(
      sandbox({
        id: 'home-id',
        name: 'home',
        kind: 'home',
        sprite_name: 'nitejar-agent-1',
        description: 'Persistent home sandbox',
        created_by: 'system',
      })
    )

    const result = await deleteSandboxTool(
      { sandbox_name: 'task-1' },
      { ...baseContext, activeSandboxName: 'task-1' }
    )

    expect(result.success).toBe(true)
    expect(result._meta?.sandboxSwitch).toEqual({
      sandboxName: 'home',
      spriteName: 'nitejar-agent-1',
    })
  })

  it('propagates home-delete protection errors', async () => {
    mockedDeleteAgentSandboxByName.mockRejectedValue(
      new Error('The home sandbox cannot be deleted.')
    )

    const result = await deleteSandboxTool({ sandbox_name: 'home' }, baseContext)

    expect(result.success).toBe(false)
    expect(result.error).toContain('cannot be deleted')
  })
})
