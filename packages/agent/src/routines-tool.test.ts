import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Routine } from '@nitejar/database'
import * as Database from '@nitejar/database'
import type { ToolContext } from './tools'
import { createRoutineTool } from './tools/handlers/routines'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    assertAgentGrant: vi.fn(),
    createRoutine: vi.fn(),
  }
})

const mockedAssertAgentGrant = vi.mocked(Database.assertAgentGrant)
const mockedCreateRoutine = vi.mocked(Database.createRoutine)

const context: ToolContext = {
  spriteName: 'nitejar-agent-1',
  agentId: 'agent-1',
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
  mockedAssertAgentGrant.mockReset()
  mockedCreateRoutine.mockReset()
})

describe('createRoutineTool', () => {
  it('rejects writes when routine.self.manage grant is missing', async () => {
    mockedAssertAgentGrant.mockRejectedValue(
      new Error('Access denied: missing grant "routine.self.manage".')
    )

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
    expect(result.error).toContain('routine.self.manage')
    expect(mockedCreateRoutine).not.toHaveBeenCalled()
  })

  it('creates routine when routine.self.manage grant is present', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
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
