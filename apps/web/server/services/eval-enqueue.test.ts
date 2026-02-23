import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nitejar/database', () => ({
  listActiveEvaluatorsForAgent: vi.fn(),
  getEvalSettings: vi.fn(),
  countEvalRunsForAgentToday: vi.fn(),
  countCompletedRunsForAgentToday: vi.fn(),
  findJobById: vi.fn(),
  findActivityByJobId: vi.fn(),
  createEvalRun: vi.fn(),
}))

import {
  listActiveEvaluatorsForAgent,
  getEvalSettings,
  countEvalRunsForAgentToday,
  countCompletedRunsForAgentToday,
  findJobById,
  findActivityByJobId,
  createEvalRun,
} from '@nitejar/database'
import { maybeEnqueueEvalPipeline } from './eval-enqueue'

const mockedListActive = vi.mocked(listActiveEvaluatorsForAgent)
const mockedGetSettings = vi.mocked(getEvalSettings)
const mockedCountEvalRuns = vi.mocked(countEvalRunsForAgentToday)
const mockedCountCompletedRuns = vi.mocked(countCompletedRunsForAgentToday)
const mockedFindJob = vi.mocked(findJobById)
const mockedFindActivity = vi.mocked(findActivityByJobId)
const mockedCreateEvalRun = vi.mocked(createEvalRun)

const DEFAULT_SETTINGS = {
  id: 'default',
  judge_model: null,
  max_daily_evals: 50,
  sample_rate_default: 1.0,
  sample_rate_high_volume_threshold: 20,
  sample_rate_high_volume: 0.2,
  eval_cost_budget_usd: null,
  created_at: 1700000000,
  updated_at: 1700000000,
}

describe('maybeEnqueueEvalPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Ensure Math.random always returns 0 so sampling always passes
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  it('skips when agent has no active evaluators', async () => {
    mockedListActive.mockResolvedValue([])

    await maybeEnqueueEvalPipeline('job-1', 'agent-1', 'wi-1')

    expect(mockedGetSettings).not.toHaveBeenCalled()
    expect(mockedCreateEvalRun).not.toHaveBeenCalled()
  })

  it('skips when daily eval limit is reached', async () => {
    mockedListActive.mockResolvedValue([{ evaluator_id: 'ev-1' }] as never)
    mockedGetSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, max_daily_evals: 10 })
    mockedCountEvalRuns.mockResolvedValue(10)

    await maybeEnqueueEvalPipeline('job-1', 'agent-1', 'wi-1')

    expect(mockedFindJob).not.toHaveBeenCalled()
    expect(mockedCreateEvalRun).not.toHaveBeenCalled()
  })

  it('skips when job is not found', async () => {
    mockedListActive.mockResolvedValue([{ evaluator_id: 'ev-1' }] as never)
    mockedGetSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mockedCountEvalRuns.mockResolvedValue(0)
    mockedFindJob.mockResolvedValue(null as never)

    await maybeEnqueueEvalPipeline('job-1', 'agent-1', 'wi-1')

    expect(mockedCreateEvalRun).not.toHaveBeenCalled()
  })

  it('skips when job status is not COMPLETED', async () => {
    mockedListActive.mockResolvedValue([{ evaluator_id: 'ev-1' }] as never)
    mockedGetSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mockedCountEvalRuns.mockResolvedValue(0)
    mockedFindJob.mockResolvedValue({ id: 'job-1', status: 'FAILED' } as never)

    await maybeEnqueueEvalPipeline('job-1', 'agent-1', 'wi-1')

    expect(mockedCreateEvalRun).not.toHaveBeenCalled()
  })

  it('skips triage-pass jobs (activity status=passed)', async () => {
    mockedListActive.mockResolvedValue([{ evaluator_id: 'ev-1' }] as never)
    mockedGetSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mockedCountEvalRuns.mockResolvedValue(0)
    mockedFindJob.mockResolvedValue({ id: 'job-1', status: 'COMPLETED' } as never)
    mockedFindActivity.mockResolvedValue({ status: 'passed' } as never)

    await maybeEnqueueEvalPipeline('job-1', 'agent-1', 'wi-1')

    expect(mockedCreateEvalRun).not.toHaveBeenCalled()
  })

  it('skips when sampling rejects (random >= sampleRate)', async () => {
    mockedListActive.mockResolvedValue([{ evaluator_id: 'ev-1' }] as never)
    mockedGetSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      sample_rate_default: 0.5,
    })
    mockedCountEvalRuns.mockResolvedValue(0)
    mockedFindJob.mockResolvedValue({ id: 'job-1', status: 'COMPLETED' } as never)
    mockedFindActivity.mockResolvedValue({ status: 'completed' } as never)
    mockedCountCompletedRuns.mockResolvedValue(5)
    // random() >= 0.5 should skip
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    await maybeEnqueueEvalPipeline('job-1', 'agent-1', 'wi-1')

    expect(mockedCreateEvalRun).not.toHaveBeenCalled()
  })

  it('uses high-volume sample rate when run count exceeds threshold', async () => {
    mockedListActive.mockResolvedValue([{ evaluator_id: 'ev-1' }] as never)
    mockedGetSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      sample_rate_default: 1.0,
      sample_rate_high_volume_threshold: 10,
      sample_rate_high_volume: 0.1,
    })
    mockedCountEvalRuns.mockResolvedValue(0)
    mockedFindJob.mockResolvedValue({ id: 'job-1', status: 'COMPLETED' } as never)
    mockedFindActivity.mockResolvedValue({ status: 'completed' } as never)
    // Above the threshold of 10
    mockedCountCompletedRuns.mockResolvedValue(15)
    // random() returns 0.2 which is >= 0.1, so should skip
    vi.spyOn(Math, 'random').mockReturnValue(0.2)

    await maybeEnqueueEvalPipeline('job-1', 'agent-1', 'wi-1')

    expect(mockedCreateEvalRun).not.toHaveBeenCalled()
  })

  it('enqueues eval run on happy path', async () => {
    mockedListActive.mockResolvedValue([{ evaluator_id: 'ev-1' }] as never)
    mockedGetSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mockedCountEvalRuns.mockResolvedValue(0)
    mockedFindJob.mockResolvedValue({ id: 'job-1', status: 'COMPLETED' } as never)
    mockedFindActivity.mockResolvedValue({ status: 'completed' } as never)
    mockedCountCompletedRuns.mockResolvedValue(5)
    mockedCreateEvalRun.mockResolvedValue({ id: 'run-1' } as never)

    await maybeEnqueueEvalPipeline('job-1', 'agent-1', 'wi-1')

    expect(mockedCreateEvalRun).toHaveBeenCalledWith({
      job_id: 'job-1',
      agent_id: 'agent-1',
      work_item_id: 'wi-1',
      trigger: 'auto',
      status: 'pending',
    })
  })

  it('enqueues when activity is null (no triage-pass check blocks)', async () => {
    mockedListActive.mockResolvedValue([{ evaluator_id: 'ev-1' }] as never)
    mockedGetSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mockedCountEvalRuns.mockResolvedValue(0)
    mockedFindJob.mockResolvedValue({ id: 'job-1', status: 'COMPLETED' } as never)
    mockedFindActivity.mockResolvedValue(null as never)
    mockedCountCompletedRuns.mockResolvedValue(0)
    mockedCreateEvalRun.mockResolvedValue({ id: 'run-1' } as never)

    await maybeEnqueueEvalPipeline('job-1', 'agent-1', 'wi-1')

    expect(mockedCreateEvalRun).toHaveBeenCalled()
  })
})
