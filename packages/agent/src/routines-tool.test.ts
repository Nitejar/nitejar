import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Routine } from '@nitejar/database'
import * as Database from '@nitejar/database'
import type { ToolContext } from './tools'
import { createRoutineTool, getRoutineTool } from './tools/handlers/routines'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')

  function compileTarget(target: Database.RoutineTarget) {
    if (target.kind === 'plugin_conversation') {
      return {
        target,
        targetSpecJson: JSON.stringify(target),
        targetPluginInstanceId: target.pluginInstanceId,
        targetSessionKey: target.sessionKey,
        targetResponseContext: null,
      }
    }

    const targetId =
      target.kind === 'app_ticket'
        ? target.ticketId
        : target.kind === 'app_goal'
          ? target.goalId
          : target.kind === 'app_routine'
            ? target.routineId
            : 'session'

    return {
      target,
      targetSpecJson: JSON.stringify(target),
      targetPluginInstanceId: null,
      targetSessionKey:
        target.kind === 'app_session'
          ? target.sessionKey
          : `app:${target.kind}:${targetId}:__family__`,
      targetResponseContext: null,
    }
  }

  return {
    ...actual,
    assertAgentGrant: vi.fn(),
    createRoutine: vi.fn(),
    findRoutineById: vi.fn(),
    validateAndCompileRoutineTarget: vi.fn(({ target }: { target: Database.RoutineTarget }) =>
      compileTarget(target)
    ),
  }
})

const mockedAssertAgentGrant = vi.mocked(Database.assertAgentGrant)
const mockedCreateRoutine = vi.mocked(Database.createRoutine)
const mockedFindRoutineById = vi.mocked(Database.findRoutineById)

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
    target_spec_json: JSON.stringify({
      kind: 'plugin_conversation',
      pluginInstanceId: 'integration-1',
      sessionKey: 'telegram:123',
    }),
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
  mockedFindRoutineById.mockReset()
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
        target: {
          kind: 'plugin_conversation',
          pluginInstanceId: 'integration-1',
          sessionKey: 'telegram:123',
        },
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
        target: {
          kind: 'plugin_conversation',
          pluginInstanceId: 'integration-1',
          sessionKey: 'telegram:123',
        },
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

  it('creates routine when routine.manage grant is present', async () => {
    mockedAssertAgentGrant.mockImplementation(({ action }) => {
      if (action === 'routine.self.manage') {
        return Promise.reject(new Error('Access denied: missing grant "routine.self.manage".'))
      }
      return Promise.resolve(undefined)
    })
    mockedCreateRoutine.mockResolvedValue(routine())

    const result = await createRoutineTool(
      {
        name: 'Daily check',
        trigger_kind: 'event',
        target: {
          kind: 'plugin_conversation',
          pluginInstanceId: 'integration-1',
          sessionKey: 'telegram:123',
        },
        action_prompt: 'Run check',
        rule_json: { field: 'eventType', op: 'eq', value: 'message' },
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedAssertAgentGrant).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: 'routine.self.manage' })
    )
    expect(mockedAssertAgentGrant).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: 'routine.manage' })
    )
    expect(mockedCreateRoutine).toHaveBeenCalled()
  })

  it('creates an app-session routine without a plugin delivery target', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedCreateRoutine.mockResolvedValue({
      ...routine(),
      target_plugin_instance_id: null,
      target_session_key: 'app:user-1:s1',
    })

    const result = await createRoutineTool(
      {
        name: 'Session follow-up',
        trigger_kind: 'event',
        target: {
          kind: 'app_session',
          sessionKey: 'app:user-1:s1',
          sessionMode: 'fresh',
        },
        action_prompt: 'Continue work in this session',
        rule_json: { field: 'eventType', op: 'eq', value: 'message' },
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedCreateRoutine).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Session follow-up',
        target_plugin_instance_id: null,
        target_session_key: 'app:user-1:s1',
      })
    )
  })
})

describe('getRoutineTool', () => {
  it('returns the live response context for a specific routine', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedFindRoutineById.mockResolvedValue({
      ...routine(),
      target_plugin_instance_id: null,
      target_session_key: 'app:user-1:s1',
      target_response_context: '{"goal_id":"goal-1","platform_fix_ticket_id":"ticket-1"}',
      target_spec_json: JSON.stringify({
        kind: 'app_session',
        sessionKey: 'app:user-1:s1',
        sessionMode: 'fresh',
      }),
      next_run_at: 1_777_777_777,
      last_fired_at: 1_777_777_700,
      last_status: 'fired',
    })

    const result = await getRoutineTool({ routine_id: 'routine-1' }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('Routine routine-1')
    expect(result.output).toContain(
      'target: {"kind":"app_session","sessionKey":"app:user-1:s1","sessionMode":"fresh"}'
    )
  })

  it('rejects routines owned by someone else', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedFindRoutineById.mockResolvedValue({
      ...routine(),
      agent_id: 'agent-2',
    })

    const result = await getRoutineTool({ routine_id: 'routine-1' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})
