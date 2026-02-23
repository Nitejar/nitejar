import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nitejar/database', () => ({
  searchRuns: vi.fn(),
  findJobById: vi.fn(),
  listMessagesByJobPaged: vi.fn(),
  listBackgroundTasksByJobPaged: vi.fn(),
  countMessagesByJob: vi.fn(),
  countBackgroundTasksByJob: vi.fn(),
  getCostByJobs: vi.fn(),
}))

vi.mock('@/server/services/runtime-control', () => ({
  getRunControlByJob: vi.fn(),
}))

import {
  searchRuns,
  findJobById,
  listMessagesByJobPaged,
  listBackgroundTasksByJobPaged,
  countMessagesByJob,
  countBackgroundTasksByJob,
  getCostByJobs,
} from '@nitejar/database'
import { getRunControlByJob } from '@/server/services/runtime-control'
import { getRunOp, searchRunsOp } from './runs'

const mockedSearchRuns = vi.mocked(searchRuns)
const mockedFindJobById = vi.mocked(findJobById)
const mockedListMessagesByJobPaged = vi.mocked(listMessagesByJobPaged)
const mockedListBackgroundTasksByJobPaged = vi.mocked(listBackgroundTasksByJobPaged)
const mockedCountMessagesByJob = vi.mocked(countMessagesByJob)
const mockedCountBackgroundTasksByJob = vi.mocked(countBackgroundTasksByJob)
const mockedGetCostByJobs = vi.mocked(getCostByJobs)
const mockedGetRunControlByJob = vi.mocked(getRunControlByJob)

describe('runs ops', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('decodes and re-encodes run cursor', async () => {
    mockedSearchRuns.mockResolvedValue({
      runs: [{ job_id: 'job-1', created_at: 100 } as never],
      nextCursor: { createdAt: 90, id: 'job-0' },
    })

    const cursor = Buffer.from(JSON.stringify({ createdAt: 120, id: 'job-9' }), 'utf8').toString(
      'base64url'
    )
    const result = await searchRunsOp({ cursor })

    expect(mockedSearchRuns).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { createdAt: 120, id: 'job-9' } })
    )
    expect(result.runs).toHaveLength(1)
    expect(result.nextCursor).toBe(
      Buffer.from(JSON.stringify({ createdAt: 90, id: 'job-0' }), 'utf8').toString('base64url')
    )
  })

  it('rejects malformed run cursor', async () => {
    await expect(searchRunsOp({ cursor: 'bad!!' })).rejects.toThrow('Invalid cursor')
  })

  it('loads optional sections for getRun', async () => {
    mockedFindJobById.mockResolvedValue({
      id: 'job-1',
      work_item_id: 'wi-1',
      agent_id: 'agent-1',
      status: 'RUNNING',
      error_text: null,
      todo_state: null,
      final_response: null,
      started_at: null,
      completed_at: null,
      created_at: 1,
      updated_at: 1,
    })
    mockedCountMessagesByJob.mockResolvedValue(1)
    mockedCountBackgroundTasksByJob.mockResolvedValue(1)
    mockedListMessagesByJobPaged.mockResolvedValue([
      { id: 'm-1', content: '{"text":"hello"}' } as never,
    ])
    mockedListBackgroundTasksByJobPaged.mockResolvedValue([{ id: 'bt-1' } as never])
    mockedGetRunControlByJob.mockResolvedValue({ dispatchId: 'd-1' } as never)
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

    const result = await getRunOp({
      jobId: 'job-1',
      includeMessages: true,
      includeBackgroundTasks: true,
      includeControl: true,
    })

    expect(result.run.id).toBe('job-1')
    expect(result.messages).toBeDefined()
    expect(result.messagesPage?.total).toBe(1)
    expect(result.backgroundTasks).toBeDefined()
    expect(result.backgroundTasksPage?.total).toBe(1)
    expect(result.runControl).toBeDefined()
    expect(result.cost?.total_cost).toBe(1)
  })
})
