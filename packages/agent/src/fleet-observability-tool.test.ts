import * as fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Database from '@nitejar/database'
import type { ToolContext } from './tools'
import {
  __fleetObservabilityTest,
  getDispatchDecisionsTool,
  getMessageChunkTool,
  getRunTraceTool,
  getWorkItemQueueMessagesTool,
  getWorkItemTool,
  searchRunsTool,
  searchWorkItemsTool,
} from './tools/handlers/fleet-observability'
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
    findWorkItemById: vi.fn(),
    countMessagesByJob: vi.fn(),
    countBackgroundTasksByJob: vi.fn(),
    countSpansByJob: vi.fn(),
    countInferenceCallsByJob: vi.fn(),
    countExternalApiCallsByJob: vi.fn(),
    countQueueMessagesByWorkItem: vi.fn(),
    getCostByJobs: vi.fn(),
    listMessagesByJob: vi.fn(),
    listMessagesByJobPaged: vi.fn(),
    listBackgroundTasksByJobPaged: vi.fn(),
    listSpansByJobPaged: vi.fn(),
    listInferenceCallsByJobPaged: vi.fn(),
    listInferenceCallsByJobWithPayloadsPaged: vi.fn(),
    listExternalApiCallsByJobPaged: vi.fn(),
    getJobSpanSummary: vi.fn(),
    listSpansByJob: vi.fn(),
    findActivityByJobId: vi.fn(),
    findRunDispatchByJobId: vi.fn(),
    listJobsByWorkItem: vi.fn(),
    listRunDispatchesByWorkItem: vi.fn(),
    listEffectOutboxByWorkItem: vi.fn(),
    listQueueMessagesByWorkItem: vi.fn(),
    findRunDispatchById: vi.fn(),
    findMessageById: vi.fn(),
  }
})

const mockedAssertAgentGrant = vi.mocked(Database.assertAgentGrant)
const mockedSearchRuns = vi.mocked(Database.searchRuns)
const mockedSearchWorkItems = vi.mocked(Database.searchWorkItems)
const mockedGetCostByWorkItems = vi.mocked(Database.getCostByWorkItems)
const mockedFindJobById = vi.mocked(Database.findJobById)
const mockedFindWorkItemById = vi.mocked(Database.findWorkItemById)
const mockedCountMessagesByJob = vi.mocked(Database.countMessagesByJob)
const mockedCountBackgroundTasksByJob = vi.mocked(Database.countBackgroundTasksByJob)
const mockedCountSpansByJob = vi.mocked(Database.countSpansByJob)
const mockedCountInferenceCallsByJob = vi.mocked(Database.countInferenceCallsByJob)
const mockedCountExternalApiCallsByJob = vi.mocked(Database.countExternalApiCallsByJob)
const mockedCountQueueMessagesByWorkItem = vi.mocked(Database.countQueueMessagesByWorkItem)
const mockedGetCostByJobs = vi.mocked(Database.getCostByJobs)
const mockedListMessagesByJob = vi.mocked(Database.listMessagesByJob)
const mockedListMessagesByJobPaged = vi.mocked(Database.listMessagesByJobPaged)
const mockedListBackgroundTasksByJobPaged = vi.mocked(Database.listBackgroundTasksByJobPaged)
const mockedListSpansByJobPaged = vi.mocked(Database.listSpansByJobPaged)
const mockedListInferenceCallsByJobPaged = vi.mocked(Database.listInferenceCallsByJobPaged)
const mockedListInferenceCallsByJobWithPayloadsPaged = vi.mocked(
  Database.listInferenceCallsByJobWithPayloadsPaged
)
const mockedListExternalApiCallsByJobPaged = vi.mocked(Database.listExternalApiCallsByJobPaged)
const mockedGetJobSpanSummary = vi.mocked(Database.getJobSpanSummary)
const mockedListSpansByJob = vi.mocked(Database.listSpansByJob)
const mockedFindActivityByJobId = vi.mocked(Database.findActivityByJobId)
const mockedFindRunDispatchByJobId = vi.mocked(Database.findRunDispatchByJobId)
const mockedListJobsByWorkItem = vi.mocked(Database.listJobsByWorkItem)
const mockedListRunDispatchesByWorkItem = vi.mocked(Database.listRunDispatchesByWorkItem)
const mockedListEffectOutboxByWorkItem = vi.mocked(Database.listEffectOutboxByWorkItem)
const mockedListQueueMessagesByWorkItem = vi.mocked(Database.listQueueMessagesByWorkItem)
const mockedFindRunDispatchById = vi.mocked(Database.findRunDispatchById)
const mockedFindMessageById = vi.mocked(Database.findMessageById)

type WorkItemCostSummary = Awaited<ReturnType<typeof Database.getCostByWorkItems>>[number]
type JobRecord = NonNullable<Awaited<ReturnType<typeof Database.findJobById>>>
type JobCostSummary = Awaited<ReturnType<typeof Database.getCostByJobs>>[number]
type JobMessage = Awaited<ReturnType<typeof Database.listMessagesByJobPaged>>[number]
type StoredMessage = Awaited<ReturnType<typeof Database.listMessagesByJob>>[number]
type WorkItemRecord = NonNullable<Awaited<ReturnType<typeof Database.findWorkItemById>>>
type StoredMessageRecord = NonNullable<Awaited<ReturnType<typeof Database.findMessageById>>>

const context: ToolContext = {
  agentId: 'agent-ceo',
  spriteName: 'nitejar-ceo',
}

const fleetHelpers = __fleetObservabilityTest

function makeRun(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'run-2',
    agent_id: 'agent-ceo',
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
    ...overrides,
  }
}

describe('fleet observability helpers', () => {
  it('normalizes offsets and resolves bounded page sizes', () => {
    expect(fleetHelpers.normalizeOffset(3.8)).toBe(3)
    expect(fleetHelpers.normalizeOffset(-2)).toBe(0)
    expect(fleetHelpers.normalizeOffset('bad')).toBe(0)

    expect(fleetHelpers.resolvePageLimit(10, 2, 4, 8)).toBe(4)
    expect(fleetHelpers.resolvePageLimit(3, 5, 10, 8)).toBe(8)
    expect(fleetHelpers.resolvePageLimit(20, 0, undefined, 5)).toBe(5)
  })

  it('builds page info and handles utf8 truncation and chunking', () => {
    expect(
      fleetHelpers.buildPageInfo({
        offset: 1,
        limit: 2,
        returned: 2,
        total: 5,
      })
    ).toEqual({
      offset: 1,
      limit: 2,
      returned: 2,
      total: 5,
      hasMore: true,
      nextOffset: 3,
    })
    expect(
      fleetHelpers.buildPageInfo({
        offset: 4,
        limit: 2,
        returned: 1,
        total: 5,
      })
    ).toMatchObject({
      hasMore: false,
      nextOffset: null,
    })

    expect(fleetHelpers.truncateUtf8('hello', 10)).toEqual({
      text: 'hello',
      truncated: false,
    })
    expect(fleetHelpers.truncateUtf8('hello world', 5)).toEqual({
      text: 'hello',
      truncated: true,
    })

    expect(fleetHelpers.getUtf8Chunk('abcdefghij', 1, 4)).toMatchObject({
      text: 'efgh',
      hasMore: true,
      totalChunks: 3,
    })
    expect(fleetHelpers.getUtf8Chunk('abc', 3, 2)).toMatchObject({
      text: '',
      hasMore: false,
      startByte: 6,
      endByte: 6,
    })
  })

  it('encodes cursors and parses arbiter decisions safely', () => {
    const encoded = fleetHelpers.encodeCursor({ createdAt: 10, id: 'run-1' })

    expect(encoded).toBeTypeOf('string')
    expect(fleetHelpers.encodeCursor(null)).toBeNull()
    expect(fleetHelpers.decodeCursor(encoded ?? undefined)).toEqual({
      createdAt: 10,
      id: 'run-1',
    })
    expect(fleetHelpers.decodeCursor('bad-cursor')).toBeNull()
    expect(fleetHelpers.decodeCursor(undefined)).toBeNull()

    expect(fleetHelpers.parseDispatchDecision(null)).toEqual({
      kind: 'control',
      decision: null,
      reason: null,
    })
    expect(fleetHelpers.parseDispatchDecision('manual review')).toEqual({
      kind: 'control',
      decision: null,
      reason: 'manual review',
    })
    expect(fleetHelpers.parseDispatchDecision('arbiter:claim:best fit')).toEqual({
      kind: 'arbiter',
      decision: 'claim',
      reason: 'best fit',
    })
  })

  it('finds and reads triage logs while skipping malformed lines', async () => {
    const originalCwd = process.cwd()
    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'nitejar-triage-'))
    const nestedDir = path.join(tempRoot, 'packages', 'agent')
    await fsPromises.mkdir(path.join(tempRoot, 'logs'), { recursive: true })
    await fsPromises.mkdir(nestedDir, { recursive: true })
    await fsPromises.writeFile(
      path.join(tempRoot, 'logs', 'triage.jsonl'),
      [
        '{"workItemId":"work-2","timestamp":"2025-01-02T00:00:00.000Z"}',
        'not-json',
        '{"workItemId":"work-1","timestamp":"2025-01-03T00:00:00.000Z","agentId":"agent-b"}',
        '{"workItemId":"work-1","timestamp":"2025-01-01T00:00:00.000Z","agentId":"agent-a"}',
      ].join('\n')
    )
    process.chdir(nestedDir)

    const triagePath = await fleetHelpers.resolveTriageLogPath()
    const entries = await fleetHelpers.readTriageLogEntriesForWorkItem('work-1')

    expect(triagePath).toContain('logs/triage.jsonl')
    expect(entries.map((entry) => entry.agentId)).toEqual(['agent-a', 'agent-b'])

    process.chdir(originalCwd)
    await fsPromises.rm(tempRoot, { recursive: true, force: true })
  })

  it('returns no triage entries when no log file can be read', async () => {
    const originalCwd = process.cwd()
    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'nitejar-triage-empty-'))
    const nestedDir = path.join(tempRoot, 'packages', 'agent')
    await fsPromises.mkdir(nestedDir, { recursive: true })
    process.chdir(nestedDir)

    await expect(fleetHelpers.resolveTriageLogPath()).resolves.toBeNull()
    await expect(fleetHelpers.readTriageLogEntriesForWorkItem('work-1')).resolves.toEqual([])

    process.chdir(originalCwd)
    await fsPromises.rm(tempRoot, { recursive: true, force: true })
  })
})

describe('fleet observability tools', () => {
  beforeEach(() => {
    mockedAssertAgentGrant.mockReset()
    mockedSearchRuns.mockReset()
    mockedSearchWorkItems.mockReset()
    mockedGetCostByWorkItems.mockReset()
    mockedFindJobById.mockReset()
    mockedFindWorkItemById.mockReset()
    mockedCountMessagesByJob.mockReset()
    mockedCountBackgroundTasksByJob.mockReset()
    mockedCountSpansByJob.mockReset()
    mockedCountInferenceCallsByJob.mockReset()
    mockedCountExternalApiCallsByJob.mockReset()
    mockedCountQueueMessagesByWorkItem.mockReset()
    mockedGetCostByJobs.mockReset()
    mockedListMessagesByJob.mockReset()
    mockedListMessagesByJobPaged.mockReset()
    mockedListBackgroundTasksByJobPaged.mockReset()
    mockedListSpansByJobPaged.mockReset()
    mockedListInferenceCallsByJobPaged.mockReset()
    mockedListInferenceCallsByJobWithPayloadsPaged.mockReset()
    mockedListExternalApiCallsByJobPaged.mockReset()
    mockedGetJobSpanSummary.mockReset()
    mockedListSpansByJob.mockReset()
    mockedFindActivityByJobId.mockReset()
    mockedFindRunDispatchByJobId.mockReset()
    mockedListJobsByWorkItem.mockReset()
    mockedListRunDispatchesByWorkItem.mockReset()
    mockedListEffectOutboxByWorkItem.mockReset()
    mockedListQueueMessagesByWorkItem.mockReset()
    mockedFindRunDispatchById.mockReset()
    mockedFindMessageById.mockReset()
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
    mockedFindJobById.mockResolvedValue(makeRun({ agent_id: 'agent-scout' }))
    mockedAssertAgentGrant.mockRejectedValue(
      new Error('Access denied: missing grant "fleet.run.read".')
    )

    const result = await getRunTool({ run_id: 'run-2' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('belongs to a different agent')
  })

  it('lets fleet.run.read inspect another agent run in structured mode', async () => {
    mockedFindJobById.mockResolvedValue(makeRun({ agent_id: 'agent-scout' }))
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

  it('requires a run id for get_run', async () => {
    const result = await getRunTool({}, context)

    expect(result.success).toBe(false)
    expect(result.error).toBe('jobId or run_id is required.')
    expect(mockedFindJobById).not.toHaveBeenCalled()
  })

  it('returns an unknown-section error for unsupported legacy sections', async () => {
    mockedFindJobById.mockResolvedValue(makeRun())
    mockedAssertAgentGrant.mockRejectedValue(new Error('missing grant'))

    const result = await getRunTool({ run_id: 'run-2', section: 'mystery' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown section "mystery"')
  })

  it('omits message content and includes paging metadata in structured mode', async () => {
    mockedFindJobById.mockResolvedValue(makeRun())
    mockedAssertAgentGrant.mockRejectedValue(new Error('missing grant'))
    mockedCountMessagesByJob.mockResolvedValue(3)
    mockedCountBackgroundTasksByJob.mockResolvedValue(4)
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
    mockedListBackgroundTasksByJobPaged.mockResolvedValue([
      {
        id: 'task-1',
        job_id: 'run-2',
        kind: 'shell',
        status: 'completed',
        title: 'Build bundle',
        started_at: 1,
        completed_at: 2,
        created_at: 1,
        updated_at: 2,
      } as never,
      {
        id: 'task-2',
        job_id: 'run-2',
        kind: 'shell',
        status: 'running',
        title: 'Upload artifact',
        started_at: 3,
        completed_at: null,
        created_at: 3,
        updated_at: 4,
      } as never,
    ])
    mockedFindActivityByJobId.mockResolvedValue({
      id: 'activity-1',
      job_id: 'run-2',
      work_item_id: 'work-2',
      summary: 'Run is healthy',
      triage_decision: null,
      created_at: 1,
      updated_at: 1,
    } as never)

    const result = await getRunTool(
      {
        jobId: 'run-2',
        includeMessages: true,
        includeBackgroundTasks: true,
        includeControl: true,
        includeFullMessageContent: false,
        backgroundTaskOffset: 1,
        backgroundTaskLimit: 2,
      },
      context
    )

    const parsed = JSON.parse(result.output ?? '{}') as Record<string, unknown>
    expect(result.success).toBe(true)
    expect(parsed.activity).toMatchObject({ summary: 'Run is healthy' })
    expect(parsed.messages).toMatchObject([
      {
        content: null,
        contentMeta: {
          omitted: true,
          truncated: false,
        },
      },
    ])
    expect(parsed.messagesPage).toMatchObject({
      total: 3,
      hasMore: true,
      nextOffset: 1,
    })
    expect(parsed.backgroundTasksPage).toMatchObject({
      offset: 1,
      total: 4,
      returned: 2,
      hasMore: true,
      nextOffset: 3,
    })
  })

  it('truncates structured message content when maxContentBytes is set', async () => {
    mockedFindJobById.mockResolvedValue(makeRun())
    mockedAssertAgentGrant.mockRejectedValue(new Error('missing grant'))
    mockedCountMessagesByJob.mockResolvedValue(1)
    mockedCountBackgroundTasksByJob.mockResolvedValue(0)
    mockedGetCostByJobs.mockResolvedValue([])
    mockedListMessagesByJobPaged.mockResolvedValue([
      {
        id: 'msg-1',
        job_id: 'run-2',
        role: 'assistant',
        content: 'abcdefghijklmnopqrstuvwxyz',
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
        maxContentBytes: 10,
      },
      context
    )

    const parsed = JSON.parse(result.output ?? '{}') as {
      messages: Array<{
        content: string
        contentMeta: { truncated: boolean; returnedBytes: number }
      }>
    }
    expect(parsed.messages[0]?.content).not.toBe('abcdefghijklmnopqrstuvwxyz')
    expect(parsed.messages[0]?.contentMeta.truncated).toBe(true)
    expect(parsed.messages[0]?.contentMeta.returnedBytes).toBeLessThanOrEqual(10)
  })

  it('falls back to assistant messages when final_response is missing', async () => {
    mockedFindJobById.mockResolvedValue(makeRun({ final_response: null }))
    mockedAssertAgentGrant.mockRejectedValue(new Error('missing grant'))
    mockedListMessagesByJob.mockResolvedValue([
      {
        id: 'msg-1',
        job_id: 'run-2',
        role: 'assistant',
        content: JSON.stringify([{ text: 'Summarized result' }]),
        embedding: null,
        created_at: 2,
      } satisfies StoredMessage,
      {
        id: 'msg-2',
        job_id: 'run-2',
        role: 'assistant',
        content: 'Raw fallback',
        embedding: null,
        created_at: 3,
      } satisfies StoredMessage,
    ])

    const result = await getRunTool({ run_id: 'run-2', section: 'response' }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('Summarized result')
    expect(result.output).toContain('Raw fallback')
  })

  it('renders sender attribution in messages mode', async () => {
    mockedFindJobById.mockResolvedValue(makeRun({ final_response: null }))
    mockedAssertAgentGrant.mockRejectedValue(new Error('missing grant'))
    mockedListMessagesByJob.mockResolvedValue([
      {
        id: 'msg-1',
        job_id: 'run-2',
        role: 'assistant',
        content: JSON.stringify('[@Scout]: I found the problem'),
        embedding: null,
        created_at: 2,
      } satisfies StoredMessage,
      {
        id: 'msg-2',
        job_id: 'run-2',
        role: 'user',
        content: '[From: Josh @josh | telegram]\nPlease investigate auth',
        embedding: null,
        created_at: 3,
      } satisfies StoredMessage,
    ])

    const result = await getRunTool({ run_id: 'run-2', section: 'messages' }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('@scout: [@Scout]: I found the problem')
    expect(result.output).toContain(
      'Josh @josh: [From: Josh @josh | telegram] Please investigate auth'
    )
  })

  it('returns a no-span receipt when timeline has no spans', async () => {
    mockedFindJobById.mockResolvedValue(makeRun())
    mockedAssertAgentGrant.mockRejectedValue(new Error('missing grant'))
    mockedListSpansByJob.mockResolvedValue([])

    const result = await getRunTool({ run_id: 'run-2', section: 'timeline' }, context)

    expect(result).toEqual({
      success: true,
      output: '(No spans recorded for this run.)',
    })
  })

  it('renders a flat timeline when spans have no turn containers', async () => {
    mockedFindJobById.mockResolvedValue(makeRun())
    mockedAssertAgentGrant.mockRejectedValue(new Error('missing grant'))
    mockedListSpansByJob.mockResolvedValue([
      {
        id: 'span-1',
        job_id: 'run-2',
        parent_span_id: null,
        name: 'model_call',
        status: 'ok',
        attributes: null,
        start_time: 1,
        end_time: 2,
        duration_ms: 1000,
        created_at: 1,
      } as never,
      {
        id: 'span-2',
        job_id: 'run-2',
        parent_span_id: null,
        name: 'tool_exec',
        status: 'error',
        attributes: null,
        start_time: 3,
        end_time: 4,
        duration_ms: 500,
        created_at: 3,
      } as never,
    ])

    const result = await getRunTool({ run_id: 'run-2', section: 'timeline' }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('model_call (1.0s)')
    expect(result.output).toContain('tool_exec [ERROR] (0.5s)')
  })

  it('renders a compact summary section', async () => {
    mockedFindJobById.mockResolvedValue(makeRun({ error_text: 'none' }))
    mockedAssertAgentGrant.mockRejectedValue(new Error('missing grant'))
    mockedFindWorkItemById.mockResolvedValue({
      id: 'work-2',
      plugin_instance_id: null,
      session_key: 'session-2',
      source: 'manual',
      source_ref: 'manual:2',
      status: 'DONE',
      title: 'Investigate auth flow',
      payload: null,
      created_at: 1,
      updated_at: 1,
    } as never)
    mockedGetJobSpanSummary.mockResolvedValue({
      turn_count: 2,
      tool_count: 3,
    } as never)
    mockedGetCostByJobs.mockResolvedValue([
      {
        job_id: 'run-2',
        total_cost: 0.03,
        prompt_tokens: 11,
        completion_tokens: 22,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        call_count: 1,
        passive_memory_cost: 0,
        external_cost: 0,
      } satisfies JobCostSummary,
    ])
    mockedFindActivityByJobId.mockResolvedValue({
      id: 'activity-1',
      job_id: 'run-2',
      work_item_id: 'work-2',
      summary: 'Routed to auth owner',
      triage_decision: null,
      created_at: 1,
      updated_at: 1,
    } as never)

    const result = await getRunTool({ run_id: 'run-2', section: 'summary' }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('Title: Investigate auth flow')
    expect(result.output).toContain('Triage: Routed to auth owner')
    expect(result.output).toContain('Cost: $0.0300 (11 prompt + 22 completion tokens)')
  })

  it('rejects invalid cursors before searching fleet runs', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)

    const result = await searchRunsTool({ cursor: 'not-base64' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid cursor.')
    expect(mockedSearchRuns).not.toHaveBeenCalled()
  })

  it('returns detailed run traces with paging, truncation, and payload metadata', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedFindJobById.mockResolvedValue(makeRun())
    mockedGetJobSpanSummary.mockResolvedValue({ turn_count: 1, tool_count: 2 } as never)
    mockedGetCostByJobs.mockResolvedValue([
      {
        job_id: 'run-2',
        total_cost: 0.05,
        prompt_tokens: 21,
        completion_tokens: 34,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        call_count: 1,
        passive_memory_cost: 0,
        external_cost: 0,
      } satisfies JobCostSummary,
    ])
    mockedCountSpansByJob.mockResolvedValue(2)
    mockedCountMessagesByJob.mockResolvedValue(2)
    mockedCountInferenceCallsByJob.mockResolvedValue(1)
    mockedCountBackgroundTasksByJob.mockResolvedValue(1)
    mockedCountExternalApiCallsByJob.mockResolvedValue(1)
    mockedFindRunDispatchByJobId.mockResolvedValue({
      id: 'dispatch-1',
      work_item_id: 'work-2',
      queue_key: 'queue:1',
      status: 'claimed',
      control_state: 'claimed',
      control_reason: 'arbiter:claim:best match',
      control_updated_at: 2,
      started_at: 2,
      finished_at: null,
      created_at: 1,
      updated_at: 2,
    } as never)
    mockedListSpansByJobPaged.mockResolvedValue([
      {
        id: 'span-1',
        job_id: 'run-2',
        parent_span_id: null,
        name: 'turn',
        status: 'ok',
        attributes: null,
        start_time: 1,
        end_time: 2,
        duration_ms: 1000,
        created_at: 1,
      } as never,
    ])
    mockedListMessagesByJobPaged.mockResolvedValue([
      {
        id: 'msg-1',
        job_id: 'run-2',
        role: 'assistant',
        content: 'hello world',
        embedding: null,
        created_at: 2,
      } satisfies JobMessage,
    ])
    mockedListInferenceCallsByJobWithPayloadsPaged.mockResolvedValue([
      {
        id: 'inf-1',
        job_id: 'run-2',
        provider: 'openrouter',
        model: 'test-model',
        started_at: 1,
        completed_at: 2,
        duration_ms: 1000,
        status: 'ok',
        error_text: null,
        request_payload_json: '{"prompt":"hello world"}',
        request_payload_metadata_json: null,
        request_payload_byte_size: 24,
        response_payload_json: '{"answer":"done"}',
        response_payload_metadata_json: null,
        response_payload_byte_size: 17,
        created_at: 1,
      } as never,
    ] as never)
    mockedListBackgroundTasksByJobPaged.mockResolvedValue([
      {
        id: 'task-1',
        job_id: 'run-2',
        type: 'child',
        title: 'Explore repo',
        status: 'queued',
        payload_json: '{}',
        result_json: null,
        error_text: null,
        started_at: null,
        completed_at: null,
        created_at: 1,
        updated_at: 1,
      } as never,
    ] as never)
    mockedListExternalApiCallsByJobPaged.mockResolvedValue([
      {
        id: 'call-1',
        job_id: 'run-2',
        service: 'github',
        method: 'GET',
        url: 'https://api.github.com/repos/nitejar/nitejar',
        status_code: 200,
        duration_ms: 120,
        request_body: null,
        response_body: null,
        error_text: null,
        created_at: 1,
      } as never,
    ] as never)

    const result = await getRunTraceTool(
      {
        jobId: 'run-2',
        includeSpans: true,
        includeMessages: true,
        includeInferenceCalls: true,
        includeInferencePayloads: true,
        includeBackgroundTasks: true,
        includeExternalCalls: true,
        includeDispatch: true,
        messageOffset: 1.8,
        messageLimit: 1,
        maxContentBytes: 5,
        inferencePayloadMaxBytes: 10,
      },
      context
    )

    expect(result.success).toBe(true)
    const parsed = JSON.parse(result.output ?? '{}') as {
      messagesPage: {
        offset: number
        limit: number
        returned: number
        total: number
        hasMore: boolean
        nextOffset: number | null
      }
      messages: Array<{
        content: string
        contentMeta: {
          omitted: boolean
          truncated: boolean
          contentBytes: number
          returnedBytes: number
        }
      }>
      inferenceCalls: Array<{
        requestPayloadMeta: {
          truncated: boolean
        }
      }>
      externalCallsPage: {
        returned: number
      }
      dispatch: {
        id: string
      }
    }
    expect(parsed.messagesPage).toMatchObject({
      offset: 1,
      limit: 1,
      returned: 1,
      total: 2,
      hasMore: false,
      nextOffset: null,
    })
    const firstMessage = parsed.messages[0]
    const firstInferenceCall = parsed.inferenceCalls[0]
    expect(firstMessage).toBeDefined()
    expect(firstInferenceCall).toBeDefined()
    expect(firstMessage?.content).toBe('hello')
    expect(firstMessage?.contentMeta).toMatchObject({
      omitted: false,
      truncated: true,
      contentBytes: 11,
      returnedBytes: 5,
    })
    expect(firstInferenceCall?.requestPayloadMeta.truncated).toBe(true)
    expect(parsed.externalCallsPage.returned).toBe(1)
    expect(parsed.dispatch.id).toBe('dispatch-1')
  })

  it('returns linked runs, dispatches, and effects for a work item', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedFindWorkItemById.mockResolvedValue({
      id: 'work-2',
      plugin_instance_id: 'plugin-1',
      session_key: 'session-2',
      source: 'manual',
      source_ref: 'manual:2',
      status: 'in_progress',
      title: 'Investigate auth flow',
      payload: null,
      created_at: 1,
      updated_at: 2,
    } satisfies WorkItemRecord)
    mockedGetCostByWorkItems.mockResolvedValue([
      {
        work_item_id: 'work-2',
        total_cost: 0.11,
        prompt_tokens: 20,
        completion_tokens: 30,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      } satisfies WorkItemCostSummary,
    ])
    mockedListJobsByWorkItem.mockResolvedValue([makeRun()] as never)
    mockedListRunDispatchesByWorkItem.mockResolvedValue([
      {
        id: 'dispatch-1',
        work_item_id: 'work-2',
        queue_key: 'queue:1',
        status: 'claimed',
        control_state: 'claimed',
        control_reason: 'arbiter:claim:best match',
        control_updated_at: 2,
        started_at: 2,
        finished_at: null,
        created_at: 1,
        updated_at: 2,
      } as never,
    ] as never)
    mockedListEffectOutboxByWorkItem.mockResolvedValue([
      {
        id: 'effect-1',
        work_item_id: 'work-2',
        kind: 'comment',
        state: 'pending',
        payload_json: '{}',
        last_error: null,
        created_at: 1,
        updated_at: 1,
      },
    ] as never)

    const result = await getWorkItemTool(
      {
        workItemId: 'work-2',
        includeRuns: true,
        includeDispatches: true,
        includeEffects: true,
      },
      context
    )

    expect(result.success).toBe(true)
    expect(result.output).toContain('"Investigate auth flow"')
    expect(result.output).toContain('"dispatches"')
    expect(result.output).toContain('"effects"')
  })

  it('returns filtered queue messages with page metadata', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedFindWorkItemById.mockResolvedValue({
      id: 'work-2',
      plugin_instance_id: null,
      session_key: 'session-2',
      source: 'manual',
      source_ref: 'manual:2',
      status: 'in_progress',
      title: 'Investigate auth flow',
      payload: null,
      created_at: 1,
      updated_at: 2,
    } satisfies WorkItemRecord)
    mockedCountQueueMessagesByWorkItem.mockResolvedValue(3)
    mockedListQueueMessagesByWorkItem.mockResolvedValue([
      {
        id: 'queue-1',
        work_item_id: 'work-2',
        status: 'queued',
        agent_id: 'agent-ceo',
        queue_key: 'queue:1',
        created_at: 1,
        updated_at: 1,
      } as never,
    ] as never)

    const result = await getWorkItemQueueMessagesTool(
      {
        workItemId: 'work-2',
        statuses: ['queued', 12],
        offset: 1,
        limit: 1,
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedListQueueMessagesByWorkItem).toHaveBeenCalledWith('work-2', {
      offset: 1,
      limit: 1,
      statuses: ['queued'],
    })
    expect(result.output).toContain('"hasMore": true')
  })

  it('validates dispatch decision selectors and filters control-only rows by default', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)

    const invalid = await getDispatchDecisionsTool(
      {
        workItemId: 'work-2',
        dispatchId: 'dispatch-1',
      },
      context
    )

    expect(invalid.success).toBe(false)
    expect(invalid.error).toBe('Provide exactly one of workItemId or dispatchId.')

    mockedListRunDispatchesByWorkItem.mockResolvedValue([
      {
        id: 'dispatch-1',
        work_item_id: 'work-2',
        queue_key: 'queue:1',
        status: 'claimed',
        control_state: 'claimed',
        control_reason: 'arbiter:claim:best fit',
        control_updated_at: 2,
        started_at: 2,
        finished_at: null,
        created_at: 1,
        updated_at: 2,
      } as never,
      {
        id: 'dispatch-2',
        work_item_id: 'work-2',
        queue_key: 'queue:2',
        status: 'passed',
        control_state: 'passed',
        control_reason: 'manual review',
        control_updated_at: 3,
        started_at: null,
        finished_at: 4,
        created_at: 2,
        updated_at: 4,
      } as never,
    ] as never)

    const filtered = await getDispatchDecisionsTool({ workItemId: 'work-2' }, context)
    const parsed = JSON.parse(filtered.output ?? '{}') as {
      decisions: Array<{
        arbiter: {
          kind: string
          decision: string | null
          reason: string | null
        }
      }>
    }

    expect(filtered.success).toBe(true)
    expect(parsed.decisions).toHaveLength(1)
    const firstDecision = parsed.decisions[0]
    expect(firstDecision).toBeDefined()
    expect(firstDecision?.arbiter).toMatchObject({
      kind: 'arbiter',
      decision: 'claim',
      reason: 'best fit',
    })
  })

  it('returns chunked message content metadata', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedFindMessageById.mockResolvedValue({
      id: 'msg-42',
      job_id: 'run-2',
      role: 'assistant',
      content: 'abcdefghij',
      embedding: null,
      created_at: 4,
    } satisfies StoredMessageRecord)

    const result = await getMessageChunkTool(
      {
        messageId: 'msg-42',
        chunkIndex: 1,
        chunkSize: 4,
      },
      context
    )

    expect(result.success).toBe(true)
    const parsed = JSON.parse(result.output ?? '{}') as {
      message: {
        id: string
        jobId: string
        role: string
      }
      contentChunk: {
        chunkIndex: number
        chunkSize: number
        totalBytes: number
        totalChunks: number
        startByte: number
        endByte: number
        text: string
        hasMore: boolean
      }
    }
    expect(parsed.message).toMatchObject({
      id: 'msg-42',
      jobId: 'run-2',
      role: 'assistant',
    })
    expect(parsed.contentChunk).toMatchObject({
      chunkIndex: 1,
      chunkSize: 4,
      totalBytes: 10,
      totalChunks: 3,
      startByte: 4,
      endByte: 8,
      text: 'efgh',
      hasMore: true,
    })
  })

  it('validates message chunk lookups', async () => {
    mockedAssertAgentGrant.mockRejectedValueOnce(new Error('missing fleet.run.read'))
    const denied = await getMessageChunkTool({ messageId: 'msg-42' }, context)
    expect(denied.success).toBe(false)
    expect(denied.error).toContain('missing fleet.run.read')

    mockedAssertAgentGrant.mockResolvedValue(undefined)
    await expect(getMessageChunkTool({}, context)).resolves.toEqual({
      success: false,
      error: 'messageId is required.',
    })

    mockedFindMessageById.mockResolvedValue(null)
    await expect(getMessageChunkTool({ messageId: 'msg-404' }, context)).resolves.toEqual({
      success: false,
      error: 'Message not found.',
    })
  })
})
