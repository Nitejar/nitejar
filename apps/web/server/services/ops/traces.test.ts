import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nitejar/database', () => ({
  findJobById: vi.fn(),
  getCostByJobs: vi.fn(),
  getJobSpanSummary: vi.fn(),
  listSpansByJobPaged: vi.fn(),
  listMessagesByJobPaged: vi.fn(),
  listBackgroundTasksByJobPaged: vi.fn(),
  listExternalApiCallsByJobPaged: vi.fn(),
  listInferenceCallsByJobWithPayloadsPaged: vi.fn(),
  countSpansByJob: vi.fn(),
  countMessagesByJob: vi.fn(),
  countInferenceCallsByJob: vi.fn(),
  countBackgroundTasksByJob: vi.fn(),
  countExternalApiCallsByJob: vi.fn(),
  findRunDispatchByJobId: vi.fn(),
}))

import {
  findJobById,
  getCostByJobs,
  getJobSpanSummary,
  listBackgroundTasksByJobPaged,
  listExternalApiCallsByJobPaged,
  listInferenceCallsByJobWithPayloadsPaged,
  listMessagesByJobPaged,
  listSpansByJobPaged,
  countSpansByJob,
  countMessagesByJob,
  countInferenceCallsByJob,
  countBackgroundTasksByJob,
  countExternalApiCallsByJob,
  findRunDispatchByJobId,
} from '@nitejar/database'
import { getRunTraceOp } from './traces'

const mockedFindJobById = vi.mocked(findJobById)
const mockedGetCostByJobs = vi.mocked(getCostByJobs)
const mockedGetJobSpanSummary = vi.mocked(getJobSpanSummary)
const mockedListSpansByJobPaged = vi.mocked(listSpansByJobPaged)
const mockedListMessagesByJobPaged = vi.mocked(listMessagesByJobPaged)
const mockedListBackgroundTasksByJobPaged = vi.mocked(listBackgroundTasksByJobPaged)
const mockedListExternalApiCallsByJobPaged = vi.mocked(listExternalApiCallsByJobPaged)
const mockedListInferenceCallsByJobWithPayloadsPaged = vi.mocked(
  listInferenceCallsByJobWithPayloadsPaged
)
const mockedCountSpansByJob = vi.mocked(countSpansByJob)
const mockedCountMessagesByJob = vi.mocked(countMessagesByJob)
const mockedCountInferenceCallsByJob = vi.mocked(countInferenceCallsByJob)
const mockedCountBackgroundTasksByJob = vi.mocked(countBackgroundTasksByJob)
const mockedCountExternalApiCallsByJob = vi.mocked(countExternalApiCallsByJob)
const mockedFindRunDispatchByJobId = vi.mocked(findRunDispatchByJobId)

describe('trace ops', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedFindJobById.mockResolvedValue({
      id: 'job-1',
      work_item_id: 'wi-1',
      agent_id: 'agent-1',
      status: 'COMPLETED',
      error_text: null,
      todo_state: null,
      final_response: null,
      started_at: 1,
      completed_at: 2,
      created_at: 1,
      updated_at: 2,
    })
    mockedGetCostByJobs.mockResolvedValue([
      {
        job_id: 'job-1',
        total_cost: 1,
        prompt_tokens: 1,
        completion_tokens: 1,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        call_count: 1,
        passive_memory_cost: 0,
        external_cost: 0,
      },
    ])
    mockedGetJobSpanSummary.mockResolvedValue({
      total_duration_ms: 1000,
      turn_count: 1,
      tool_count: 1,
      error_count: 0,
    })
    mockedCountSpansByJob.mockResolvedValue(0)
    mockedCountMessagesByJob.mockResolvedValue(0)
    mockedCountInferenceCallsByJob.mockResolvedValue(0)
    mockedCountBackgroundTasksByJob.mockResolvedValue(0)
    mockedCountExternalApiCallsByJob.mockResolvedValue(0)
  })

  it('returns summary-only trace by default', async () => {
    const trace = await getRunTraceOp({ jobId: 'job-1' })
    expect(trace.summary.total_duration_ms).toBe(1000)
    expect(trace.spans).toBeUndefined()
    expect(trace.messages).toBeUndefined()
  })

  it('loads opt-in trace sections', async () => {
    mockedCountSpansByJob.mockResolvedValue(1)
    mockedCountMessagesByJob.mockResolvedValue(1)
    mockedCountInferenceCallsByJob.mockResolvedValue(1)
    mockedCountBackgroundTasksByJob.mockResolvedValue(1)
    mockedCountExternalApiCallsByJob.mockResolvedValue(1)
    mockedListSpansByJobPaged.mockResolvedValue([{ id: 's-1' } as never])
    mockedListMessagesByJobPaged.mockResolvedValue([
      { id: 'm-1', content: '{"text":"ok"}' } as never,
    ])
    mockedListInferenceCallsByJobWithPayloadsPaged.mockResolvedValue([{ id: 'ic-1' } as never])
    mockedListBackgroundTasksByJobPaged.mockResolvedValue([{ id: 'b-1' } as never])
    mockedListExternalApiCallsByJobPaged.mockResolvedValue([{ id: 'e-1' } as never])
    mockedFindRunDispatchByJobId.mockResolvedValue({ id: 'd-1' } as never)

    const trace = await getRunTraceOp({
      jobId: 'job-1',
      includeSpans: true,
      includeMessages: true,
      includeInferenceCalls: true,
      includeBackgroundTasks: true,
      includeExternalCalls: true,
      includeDispatch: true,
    })

    expect(trace.spans).toBeDefined()
    expect(trace.spansPage?.total).toBe(1)
    expect(trace.messages).toBeDefined()
    expect(trace.messagesPage?.total).toBe(1)
    expect(trace.inferenceCalls).toBeDefined()
    expect(trace.inferenceCallsPage?.total).toBe(1)
    expect(trace.backgroundTasks).toBeDefined()
    expect(trace.backgroundTasksPage?.total).toBe(1)
    expect(trace.externalCalls).toBeDefined()
    expect(trace.externalCallsPage?.total).toBe(1)
    expect(trace.dispatch).toBeDefined()
  })
})
