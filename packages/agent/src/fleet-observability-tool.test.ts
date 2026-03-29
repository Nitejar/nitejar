import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Database from '@nitejar/database'
import type { ToolContext } from './tools'
import { searchRunsTool, searchWorkItemsTool } from './tools/handlers/fleet-observability'
import { getRunTool } from './tools/handlers/run-history'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    assertAgentGrant: vi.fn(),
    searchRuns: vi.fn(),
    searchWorkItems: vi.fn(),
    getCostByWorkItems: vi.fn(),
    findJobById: vi.fn(),
    countMessagesByJob: vi.fn(),
    countBackgroundTasksByJob: vi.fn(),
    getCostByJobs: vi.fn(),
    listMessagesByJobPaged: vi.fn(),
    listBackgroundTasksByJobPaged: vi.fn(),
  }
})

const mockedAssertAgentGrant = vi.mocked(Database.assertAgentGrant)
const mockedSearchRuns = vi.mocked(Database.searchRuns)
const mockedSearchWorkItems = vi.mocked(Database.searchWorkItems)
const mockedGetCostByWorkItems = vi.mocked(Database.getCostByWorkItems)
const mockedFindJobById = vi.mocked(Database.findJobById)
const mockedCountMessagesByJob = vi.mocked(Database.countMessagesByJob)
const mockedCountBackgroundTasksByJob = vi.mocked(Database.countBackgroundTasksByJob)
const mockedGetCostByJobs = vi.mocked(Database.getCostByJobs)
const mockedListMessagesByJobPaged = vi.mocked(Database.listMessagesByJobPaged)
const mockedListBackgroundTasksByJobPaged = vi.mocked(Database.listBackgroundTasksByJobPaged)

type WorkItemCostSummary = Awaited<ReturnType<typeof Database.getCostByWorkItems>>[number]
type JobRecord = NonNullable<Awaited<ReturnType<typeof Database.findJobById>>>
type JobCostSummary = Awaited<ReturnType<typeof Database.getCostByJobs>>[number]
type JobMessage = Awaited<ReturnType<typeof Database.listMessagesByJobPaged>>[number]

const context: ToolContext = {
  agentId: 'agent-ceo',
  spriteName: 'nitejar-ceo',
}

describe('fleet observability tools', () => {
  beforeEach(() => {
    mockedAssertAgentGrant.mockReset()
    mockedSearchRuns.mockReset()
    mockedSearchWorkItems.mockReset()
    mockedGetCostByWorkItems.mockReset()
    mockedFindJobById.mockReset()
    mockedCountMessagesByJob.mockReset()
    mockedCountBackgroundTasksByJob.mockReset()
    mockedGetCostByJobs.mockReset()
    mockedListMessagesByJobPaged.mockReset()
    mockedListBackgroundTasksByJobPaged.mockReset()
  })

  it('requires fleet.run.read for search_runs', async () => {
    mockedAssertAgentGrant.mockRejectedValue(
      new Error('Access denied: missing grant "fleet.run.read".')
    )

    const result = await searchRunsTool({}, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('fleet.run.read')
    expect(mockedSearchRuns).not.toHaveBeenCalled()
  })

  it('returns structured run search results with encoded cursor', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedSearchRuns.mockResolvedValue({
      runs: [
        {
          job_id: 'run-1',
          status: 'completed',
          agent_id: 'agent-scout',
          agent_name: 'Scout',
          agent_handle: 'scout',
          work_item_id: 'work-1',
          title: 'Delegated research',
          source: 'ticket_delegate',
          source_ref: 'ticket-1',
          session_key: 'ticket_delegate:ticket-1:agent-scout',
          plugin_instance_id: null,
          error_text: null,
          created_at: 1,
          started_at: 1,
          completed_at: 2,
          total_cost: 0.01,
          call_count: 2,
        },
      ],
      nextCursor: { createdAt: 1, id: 'run-1' },
    })

    const result = await searchRunsTool({ limit: 10 }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('"run-1"')
    expect(result.output).toContain('"nextCursor"')
  })

  it('returns work items with attached costs for fleet.work.read', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedSearchWorkItems.mockResolvedValue({
      items: [
        {
          id: 'work-1',
          title: 'Delegated research',
          status: 'in_progress',
          source: 'ticket_delegate',
          source_ref: 'ticket-1',
          session_key: 'ticket_delegate:ticket-1:agent-scout',
          plugin_instance_id: null,
          payload: null,
          created_at: 1,
          updated_at: 2,
        },
      ],
      nextCursor: null,
    })
    mockedGetCostByWorkItems.mockResolvedValue([
      {
        work_item_id: 'work-1',
        total_cost: 0.02,
        prompt_tokens: 10,
        completion_tokens: 20,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      } satisfies WorkItemCostSummary,
    ])

    const result = await searchWorkItemsTool({}, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('"work-1"')
    expect(result.output).toContain('"cost"')
  })

  it('keeps get_run self-only without fleet.run.read', async () => {
    mockedFindJobById.mockResolvedValue({
      id: 'run-2',
      agent_id: 'agent-scout',
      work_item_id: 'work-2',
      parent_job_id: null,
      root_job_id: 'run-2',
      run_kind: 'primary',
      origin_tool_name: null,
      status: 'completed',
      started_at: 1,
      completed_at: 2,
      error_text: null,
      final_response: 'Done',
      todo_state: null,
      created_at: 1,
      updated_at: 2,
    } satisfies JobRecord)
    mockedAssertAgentGrant.mockRejectedValue(
      new Error('Access denied: missing grant "fleet.run.read".')
    )

    const result = await getRunTool({ run_id: 'run-2' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('belongs to a different agent')
  })

  it('lets fleet.run.read inspect another agent run in structured mode', async () => {
    mockedFindJobById.mockResolvedValue({
      id: 'run-2',
      agent_id: 'agent-scout',
      work_item_id: 'work-2',
      parent_job_id: null,
      root_job_id: 'run-2',
      run_kind: 'primary',
      origin_tool_name: null,
      status: 'completed',
      started_at: 1,
      completed_at: 2,
      error_text: null,
      final_response: 'Done',
      todo_state: null,
      created_at: 1,
      updated_at: 2,
    } satisfies JobRecord)
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedCountMessagesByJob.mockResolvedValue(1)
    mockedCountBackgroundTasksByJob.mockResolvedValue(0)
    mockedGetCostByJobs.mockResolvedValue([
      {
        job_id: 'run-2',
        total_cost: 0.01,
        prompt_tokens: 12,
        completion_tokens: 34,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        call_count: 1,
        passive_memory_cost: 0,
        external_cost: 0,
      } satisfies JobCostSummary,
    ])
    mockedListMessagesByJobPaged.mockResolvedValue([
      {
        id: 'msg-1',
        job_id: 'run-2',
        role: 'assistant',
        content: 'Scout summary',
        embedding: null,
        created_at: 2,
      } satisfies JobMessage,
    ])
    mockedListBackgroundTasksByJobPaged.mockResolvedValue([])

    const result = await getRunTool(
      {
        jobId: 'run-2',
        includeMessages: true,
        includeFullMessageContent: true,
      },
      context
    )

    expect(result.success).toBe(true)
    expect(result.output).toContain('"run-2"')
    expect(result.output).toContain('"Scout summary"')
  })
})
