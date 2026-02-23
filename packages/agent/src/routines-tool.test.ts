import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, Routine } from '@nitejar/database'
import * as Database from '@nitejar/database'
import type { ToolContext } from './tools'
import { createRoutineTool } from './tools/handlers/routines'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    findAgentById: vi.fn(),
    createRoutine: vi.fn(),
  }
})

const mockedFindAgentById = vi.mocked(Database.findAgentById)
const mockedCreateRoutine = vi.mocked(Database.createRoutine)

const context: ToolContext = {
  spriteName: 'nitejar-agent-1',
  agentId: 'agent-1',
}

function agent(config: Record<string, unknown>): Agent {
  return {
    id: 'agent-1',
    handle: 'agent',
    name: 'Agent One',
    sprite_id: null,
    status: 'idle',
    config: JSON.stringify(config),
    created_at: 0,
    updated_at: 0,
  }
}

function routine(): Routine {
  const ts = Math.floor(Date.now() / 1000)
  return {
    id: 'routine-1',
    agent_id: 'agent-1',
    name: 'Daily check',
    description: null,
    enabled: 1,
    trigger_kind: 'event',
    cron_expr: null,
    timezone: null,
    rule_json: '{}',
    condition_probe: null,
    condition_config: null,
    target_plugin_instance_id: 'integration-1',
    target_session_key: 'telegram:123',
    target_response_context: null,
    action_prompt: 'Do thing',
    next_run_at: null,
    last_evaluated_at: null,
    last_fired_at: null,
    last_status: null,
    created_by_kind: 'agent',
    created_by_ref: 'agent-1',
    created_at: ts,
    updated_at: ts,
    archived_at: null,
  }
}

beforeEach(() => {
  mockedFindAgentById.mockReset()
  mockedCreateRoutine.mockReset()
})

describe('createRoutineTool', () => {
  it('rejects writes when allowRoutineManagement is disabled', async () => {
    mockedFindAgentById.mockResolvedValue(agent({ allowRoutineManagement: false }))

    const result = await createRoutineTool(
      {
        name: 'Daily check',
        trigger_kind: 'event',
        target_plugin_instance_id: 'integration-1',
        target_session_key: 'telegram:123',
        action_prompt: 'Run check',
        rule_json: { field: 'eventType', op: 'eq', value: 'message' },
      },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('disabled')
    expect(mockedCreateRoutine).not.toHaveBeenCalled()
  })

  it('creates routine when allowRoutineManagement is enabled', async () => {
    mockedFindAgentById.mockResolvedValue(agent({ allowRoutineManagement: true }))
    mockedCreateRoutine.mockResolvedValue(routine())

    const result = await createRoutineTool(
      {
        name: 'Daily check',
        trigger_kind: 'event',
        target_plugin_instance_id: 'integration-1',
        target_session_key: 'telegram:123',
        action_prompt: 'Run check',
        rule_json: { field: 'eventType', op: 'eq', value: 'message' },
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedCreateRoutine).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Daily check',
        trigger_kind: 'event',
      })
    )
  })
})
