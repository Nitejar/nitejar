import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledItem } from '@nitejar/database'
import * as Database from '@nitejar/database'
import type { ToolContext } from './tools'
import { scheduleCheckTool } from './tools/handlers/schedule'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    createOneShotRoutineSchedule: vi.fn(),
  }
})

const mockedCreateOneShotRoutineSchedule = vi.mocked(Database.createOneShotRoutineSchedule)

const baseContext: ToolContext = {
  spriteName: 'nitejar-agent-1',
  agentId: 'agent-1',
  sessionKey: 'telegram:123',
  pluginInstanceId: 'integration-1',
  responseContext: { chatId: 123 },
}

function makeScheduledItem(overrides: Partial<ScheduledItem> = {}): ScheduledItem {
  return {
    id: 'scheduled-1',
    agent_id: 'agent-1',
    session_key: 'telegram:123',
    type: 'deferred',
    payload: 'check this later',
    run_at: Math.floor(Date.now() / 1000) + 600,
    recurrence: null,
    status: 'pending',
    source_ref: null,
    plugin_instance_id: 'integration-1',
    response_context: '{"chatId":123}',
    target_spec_json: JSON.stringify({
      kind: 'plugin_conversation',
      pluginInstanceId: 'integration-1',
      sessionKey: 'telegram:123',
    }),
    routine_id: 'routine-1',
    routine_run_id: 'run-1',
    created_at: Math.floor(Date.now() / 1000),
    fired_at: null,
    cancelled_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  mockedCreateOneShotRoutineSchedule.mockReset()
})

describe('scheduleCheckTool', () => {
  it('creates a one-shot routine and linked scheduled item', async () => {
    mockedCreateOneShotRoutineSchedule.mockResolvedValue({
      routine: {
        id: 'routine-1',
      } as never,
      run: {
        id: 'run-1',
      } as never,
      scheduledItem: makeScheduledItem(),
    })

    const result = await scheduleCheckTool(
      {
        delay_minutes: 15,
        instructions: 'check build status',
        reference: 'https://example.com/pr/42',
      },
      baseContext
    )

    expect(result.success).toBe(true)
    expect(mockedCreateOneShotRoutineSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        targetSpecJson: JSON.stringify({
          kind: 'plugin_conversation',
          pluginInstanceId: 'integration-1',
          sessionKey: 'telegram:123',
        }),
        targetPluginInstanceId: 'integration-1',
        targetSessionKey: 'telegram:123',
        createdByKind: 'agent',
      })
    )
  })

  it('creates a scheduled check for app-session delivery with no plugin instance', async () => {
    mockedCreateOneShotRoutineSchedule.mockResolvedValue({
      routine: {
        id: 'routine-1',
      } as never,
      run: {
        id: 'run-1',
      } as never,
      scheduledItem: makeScheduledItem({ plugin_instance_id: null }),
    })

    const result = await scheduleCheckTool(
      { delay_minutes: 10, instructions: 'follow up in this app session' },
      { ...baseContext, pluginInstanceId: undefined, sessionKey: 'app:standalone:user-1:s1' }
    )

    expect(result.success).toBe(true)
    expect(mockedCreateOneShotRoutineSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        targetSpecJson: JSON.stringify({
          kind: 'app_session',
          sessionKey: 'app:standalone:user-1:s1',
          sessionMode: 'resume',
        }),
        targetPluginInstanceId: null,
        targetSessionKey: 'app:standalone:user-1:s1',
        createdByKind: 'agent',
      })
    )
  })
})
