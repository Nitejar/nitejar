import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Routine } from '@nitejar/database'
import * as Database from '@nitejar/database'
import type { ToolContext } from './tools'
import {
  createRoutineTool,
  deleteRoutineTool,
  getRoutineTool,
  listRoutinesTool,
  pauseRoutineTool,
  runRoutineNowTool,
  updateRoutineTool,
} from './tools/handlers/routines'

function parseRoutineTargetJson(routine: Routine): Database.RoutineTarget | null {
  return JSON.parse(routine.target_spec_json ?? 'null') as Database.RoutineTarget | null
}

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
    listRoutines: vi.fn(),
    updateRoutine: vi.fn(),
    setRoutineEnabled: vi.fn(),
    archiveRoutine: vi.fn(),
    enqueueRoutineRun: vi.fn(),
    getRoutineTarget: vi.fn((routine: Routine) => parseRoutineTargetJson(routine)),
    validateAndCompileRoutineTarget: vi.fn(({ target }: { target: Database.RoutineTarget }) =>
      compileTarget(target)
    ),
  }
})

const mockedAssertAgentGrant = vi.mocked(Database.assertAgentGrant)
const mockedCreateRoutine = vi.mocked(Database.createRoutine)
const mockedFindRoutineById = vi.mocked(Database.findRoutineById)
const mockedListRoutines = vi.mocked(Database.listRoutines)
const mockedUpdateRoutine = vi.mocked(Database.updateRoutine)
const mockedSetRoutineEnabled = vi.mocked(Database.setRoutineEnabled)
const mockedArchiveRoutine = vi.mocked(Database.archiveRoutine)
const mockedEnqueueRoutineRun = vi.mocked(Database.enqueueRoutineRun)
const mockedGetRoutineTarget = vi.mocked(Database.getRoutineTarget)

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
  mockedListRoutines.mockReset()
  mockedUpdateRoutine.mockReset()
  mockedSetRoutineEnabled.mockReset()
  mockedArchiveRoutine.mockReset()
  mockedEnqueueRoutineRun.mockReset()
  mockedGetRoutineTarget.mockReset()
  mockedGetRoutineTarget.mockImplementation((item) => parseRoutineTargetJson(item as Routine))
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

describe('additional routine handlers', () => {
  it('lists routines and handles the empty state', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedListRoutines.mockResolvedValue([])

    await expect(listRoutinesTool({}, context)).resolves.toEqual({
      success: true,
      output: 'No routines found.',
    })

    mockedListRoutines.mockResolvedValue([
      routine(),
      {
        ...routine(),
        id: 'routine-2',
        enabled: 0,
        archived_at: Math.floor(Date.now() / 1000),
        next_run_at: null,
      },
    ])

    const listed = await listRoutinesTool({ include_archived: true }, context)
    expect(listed.success).toBe(true)
    expect(mockedListRoutines).toHaveBeenLastCalledWith({
      agentId: 'agent-1',
      includeArchived: true,
    })
    expect(listed.output).toContain('routine-1 [event] enabled')
    expect(listed.output).toContain('routine-2 [event] paused archived next=n/a')
  })

  it('updates routines with existing targets and validates missing target repairs', async () => {
    mockedFindRoutineById.mockResolvedValue(routine())
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedUpdateRoutine.mockResolvedValue(routine())

    const result = await updateRoutineTool(
      {
        routine_id: 'routine-1',
        name: 'Updated name',
        description: '  ',
        action_prompt: '  Keep going  ',
        enabled: false,
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedUpdateRoutine).toHaveBeenCalledWith(
      'routine-1',
      expect.objectContaining({
        name: 'Updated name',
        description: null,
        action_prompt: 'Keep going',
        enabled: 0,
        archived_at: null,
      })
    )

    mockedGetRoutineTarget.mockReturnValueOnce(null)
    const broken = await updateRoutineTool({ routine_id: 'routine-1' }, context)
    expect(broken.success).toBe(false)
    expect(broken.error).toBe('Routine target is invalid and must be repaired before updating.')
  })

  it('surfaces update failures and validation errors', async () => {
    mockedFindRoutineById.mockResolvedValue(routine())
    mockedAssertAgentGrant.mockResolvedValue(undefined)

    const invalidJson = await updateRoutineTool(
      {
        routine_id: 'routine-1',
        rule_json: '{not json}',
      },
      context
    )
    expect(invalidJson.success).toBe(false)
    expect(invalidJson.error).toBe('Expected valid JSON string.')

    mockedUpdateRoutine.mockResolvedValue(null)
    const failedUpdate = await updateRoutineTool({ routine_id: 'routine-1' }, context)
    expect(failedUpdate.success).toBe(false)
    expect(failedUpdate.error).toBe('Routine routine-1 update failed.')
  })

  it('pauses and archives owned routines', async () => {
    mockedFindRoutineById.mockResolvedValue(routine())
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedSetRoutineEnabled.mockResolvedValue(null)
    mockedArchiveRoutine.mockResolvedValue(null)

    const paused = await pauseRoutineTool({ routine_id: 'routine-1' }, context)
    expect(paused.success).toBe(true)
    expect(mockedSetRoutineEnabled).toHaveBeenCalledWith('routine-1', false)

    const archived = await deleteRoutineTool({ routine_id: 'routine-1' }, context)
    expect(archived.success).toBe(true)
    expect(mockedArchiveRoutine).toHaveBeenCalledWith('routine-1')
  })

  it('rejects missing or foreign routines before pause/delete', async () => {
    await expect(pauseRoutineTool({}, context)).resolves.toEqual({
      success: false,
      error: 'routine_id is required.',
    })
    await expect(deleteRoutineTool({}, context)).resolves.toEqual({
      success: false,
      error: 'routine_id is required.',
    })

    mockedFindRoutineById.mockResolvedValueOnce(null)
    await expect(pauseRoutineTool({ routine_id: 'routine-404' }, context)).resolves.toEqual({
      success: false,
      error: 'Routine routine-404 not found.',
    })

    mockedFindRoutineById.mockResolvedValueOnce({
      ...routine(),
      agent_id: 'agent-2',
    })
    await expect(deleteRoutineTool({ routine_id: 'routine-1' }, context)).resolves.toEqual({
      success: false,
      error: 'Routine routine-1 not found.',
    })
  })

  it('runs a routine immediately and updates its status', async () => {
    mockedFindRoutineById.mockResolvedValue(routine())
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedEnqueueRoutineRun.mockResolvedValue({
      scheduledItem: {
        id: 'scheduled-1',
      },
    } as never)
    mockedUpdateRoutine.mockResolvedValue(routine())

    const result = await runRoutineNowTool({ routine_id: 'routine-1' }, context)

    expect(result.success).toBe(true)
    const enqueueArgs = mockedEnqueueRoutineRun.mock.calls[0]?.[0] as
      | {
          routine?: { id?: string }
          triggerOrigin?: string
          runAt?: number
        }
      | undefined
    expect(enqueueArgs?.routine?.id).toBe('routine-1')
    expect(enqueueArgs?.triggerOrigin).toBe('manual')
    expect(typeof enqueueArgs?.runAt).toBe('number')
    expect(mockedUpdateRoutine).toHaveBeenCalledWith(
      'routine-1',
      expect.objectContaining({
        last_status: 'enqueued',
      })
    )
    expect(result.output).toContain('scheduled item scheduled-1')
  })
})
