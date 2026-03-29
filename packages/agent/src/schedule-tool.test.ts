import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledItem } from '@nitejar/database'
import * as Database from '@nitejar/database'
import type { ToolContext } from './tools'
import { cancelScheduledTool, listScheduleTool, scheduleCheckTool } from './tools/handlers/schedule'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    createOneShotRoutineSchedule: vi.fn(),
    listScheduledItemsByAgent: vi.fn(),
    findScheduledItemById: vi.fn(),
    markScheduledItemCancelled: vi.fn(),
  }
})

const mockedCreateOneShotRoutineSchedule = vi.mocked(Database.createOneShotRoutineSchedule)
const mockedListScheduledItemsByAgent = vi.mocked(Database.listScheduledItemsByAgent)
const mockedFindScheduledItemById = vi.mocked(Database.findScheduledItemById)
const mockedMarkScheduledItemCancelled = vi.mocked(Database.markScheduledItemCancelled)

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
  mockedListScheduledItemsByAgent.mockReset()
  mockedFindScheduledItemById.mockReset()
  mockedMarkScheduledItemCancelled.mockReset()
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

  it('rejects invalid schedule requests early', async () => {
    await expect(
      scheduleCheckTool({ delay_minutes: 0, instructions: 'x' }, baseContext)
    ).resolves.toEqual({
      success: false,
      error: 'delay_minutes must be between 1 and 1440.',
    })

    await expect(
      scheduleCheckTool({ delay_minutes: 10, instructions: '   ' }, baseContext)
    ).resolves.toEqual({
      success: false,
      error: 'instructions is required.',
    })

    await expect(
      scheduleCheckTool(
        { delay_minutes: 10, instructions: 'ok' },
        { ...baseContext, agentId: undefined }
      )
    ).resolves.toEqual({
      success: false,
      error: 'Missing agent identity.',
    })

    await expect(
      scheduleCheckTool(
        { delay_minutes: 10, instructions: 'ok' },
        { ...baseContext, sessionKey: undefined }
      )
    ).resolves.toEqual({
      success: false,
      error: 'Missing session key.',
    })
  })
})

describe('listScheduleTool', () => {
  it('returns a filtered list of pending scheduled items', async () => {
    mockedListScheduledItemsByAgent.mockResolvedValue([
      makeScheduledItem({
        id: 'scheduled-1',
        payload: 'x'.repeat(85),
      }),
      makeScheduledItem({
        id: 'scheduled-2',
        status: 'cancelled',
      }),
    ])

    const result = await listScheduleTool({ session_only: true }, baseContext)

    expect(result.success).toBe(true)
    expect(mockedListScheduledItemsByAgent).toHaveBeenCalledWith('agent-1', {
      sessionKey: 'telegram:123',
    })
    expect(result.output).toContain('scheduled-1')
    expect(result.output).toContain('...')
    expect(result.output).not.toContain('scheduled-2')
  })

  it('returns a friendly empty state and requires an agent id', async () => {
    mockedListScheduledItemsByAgent.mockResolvedValue([])

    await expect(listScheduleTool({}, baseContext)).resolves.toEqual({
      success: true,
      output: 'No pending scheduled items.',
    })

    await expect(listScheduleTool({}, { ...baseContext, agentId: undefined })).resolves.toEqual({
      success: false,
      error: 'Missing agent identity.',
    })
  })
})

describe('cancelScheduledTool', () => {
  it('cancels a pending item owned by the current agent', async () => {
    mockedFindScheduledItemById.mockResolvedValue(makeScheduledItem())
    mockedMarkScheduledItemCancelled.mockResolvedValue(null)

    const result = await cancelScheduledTool({ scheduled_id: 'scheduled-1' }, baseContext)

    expect(result.success).toBe(true)
    expect(mockedMarkScheduledItemCancelled).toHaveBeenCalledWith('scheduled-1')
    expect(result.output).toContain('Cancelled scheduled item scheduled-1.')
  })

  it('rejects missing, foreign, missing-item, and non-pending cancellations', async () => {
    await expect(cancelScheduledTool({}, baseContext)).resolves.toEqual({
      success: false,
      error: 'scheduled_id is required.',
    })

    mockedFindScheduledItemById.mockResolvedValueOnce(null)
    await expect(
      cancelScheduledTool({ scheduled_id: 'scheduled-404' }, baseContext)
    ).resolves.toEqual({
      success: false,
      error: 'Scheduled item scheduled-404 not found.',
    })

    mockedFindScheduledItemById.mockResolvedValueOnce(makeScheduledItem({ agent_id: 'agent-2' }))
    await expect(
      cancelScheduledTool({ scheduled_id: 'scheduled-1' }, baseContext)
    ).resolves.toEqual({
      success: false,
      error: 'Cannot cancel a scheduled item belonging to another agent.',
    })

    mockedFindScheduledItemById.mockResolvedValueOnce(makeScheduledItem({ status: 'fired' }))
    await expect(
      cancelScheduledTool({ scheduled_id: 'scheduled-1' }, baseContext)
    ).resolves.toEqual({
      success: false,
      error: 'Scheduled item is already fired.',
    })
  })
})
