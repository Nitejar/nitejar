import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('@nitejar/database', () => ({
  claimPendingEvalRun: vi.fn(),
  updateEvalRun: vi.fn(),
  createEvalResult: vi.fn(),
  listActiveEvaluatorsForAgent: vi.fn(),
  getEvalSettings: vi.fn(),
  findRubricById: vi.fn(),
  findJobById: vi.fn(),
  findWorkItemById: vi.fn(),
  findAgentById: vi.fn(),
  listMessagesByJob: vi.fn(),
  listByJob: vi.fn(),
  insertInferenceCall: vi.fn(),
  getDb: vi.fn(() => ({
    selectFrom: vi.fn(() => ({
      selectAll: vi.fn(() => ({
        where: vi.fn(() => ({
          executeTakeFirst: vi.fn(),
        })),
      })),
    })),
  })),
  decrypt: vi.fn(() => 'test-api-key'),
}))

vi.mock('@nitejar/agent/config', () => ({
  parseAgentConfig: vi.fn(() => ({ model: 'test-model', soul: 'friendly' })),
}))

import {
  claimPendingEvalRun,
  updateEvalRun,
  createEvalResult,
  listActiveEvaluatorsForAgent,
  getEvalSettings,
  findRubricById,
  findJobById,
  findWorkItemById,
  findAgentById,
  listMessagesByJob,
  listByJob as listInferenceCallsByJob,
  getDb,
} from '@nitejar/database'
import { __evalWorkerTest } from './eval-worker'

const { processEvalRun } = __evalWorkerTest

const mockedClaimRun = vi.mocked(claimPendingEvalRun)
const mockedUpdateRun = vi.mocked(updateEvalRun)
const mockedCreateResult = vi.mocked(createEvalResult)
const mockedListActive = vi.mocked(listActiveEvaluatorsForAgent)
const mockedGetSettings = vi.mocked(getEvalSettings)
const mockedFindRubric = vi.mocked(findRubricById)
const mockedFindJob = vi.mocked(findJobById)
const mockedFindWorkItem = vi.mocked(findWorkItemById)
const mockedFindAgent = vi.mocked(findAgentById)
const mockedListMessages = vi.mocked(listMessagesByJob)
const mockedListInference = vi.mocked(listInferenceCallsByJob)
const mockedGetDb = vi.mocked(getDb)

const DEFAULT_SETTINGS = {
  id: 'default',
  judge_model: 'openai/gpt-4o-mini',
  max_daily_evals: 50,
  sample_rate_default: 1.0,
  sample_rate_high_volume_threshold: 20,
  sample_rate_high_volume: 0.2,
  eval_cost_budget_usd: null,
  created_at: 1700000000,
  updated_at: 1700000000,
}

const SAMPLE_CRITERIA = [
  {
    id: 'accuracy',
    name: 'Accuracy',
    description: 'How accurate is the response?',
    weight: 3,
    scale: { 1: 'Bad', 2: 'Poor', 3: 'OK', 4: 'Good', 5: 'Great' },
  },
  {
    id: 'tone',
    name: 'Tone',
    description: 'Is the tone appropriate?',
    weight: 1,
    scale: { 1: 'Bad', 2: 'Poor', 3: 'OK', 4: 'Good', 5: 'Great' },
  },
]

function makeEvalRun(overrides = {}) {
  return {
    id: 'run-1',
    job_id: 'job-1',
    agent_id: 'agent-1',
    work_item_id: 'wi-1',
    trigger: 'auto',
    status: 'running',
    ...overrides,
  }
}

function makeAssignment(overrides = {}) {
  return {
    id: 'ae-1',
    agent_id: 'agent-1',
    evaluator_id: 'ev-1',
    weight: 1.0,
    is_active: 1,
    is_gate: 0,
    sample_rate: null,
    evaluator_name: 'Test Evaluator',
    evaluator_type: 'llm_judge',
    evaluator_config_json: JSON.stringify({ rubric_id: 'rubric-1' }),
    evaluator_judge_model: null,
    created_at: 1700000000,
    updated_at: 1700000000,
    ...overrides,
  }
}

function makeJudgeResponse(scores: Array<{ id: string; name: string; score: number }>) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            criteria_scores: scores.map((s) => ({
              criterion_id: s.id,
              criterion_name: s.name,
              score: s.score,
              reasoning: `Score of ${s.score} for ${s.name}`,
            })),
            overall_reasoning: 'Overall evaluation complete',
          }),
        },
      },
    ],
    usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 },
  }
}

function setupGatewayMock() {
  const mockExecuteTakeFirst = vi.fn().mockResolvedValue({
    api_key_encrypted: 'encrypted-key',
    base_url: 'https://openrouter.ai/api/v1',
  })
  const mockWhere = vi.fn(() => ({ executeTakeFirst: mockExecuteTakeFirst }))
  const mockSelectAll = vi.fn(() => ({ where: mockWhere }))
  const mockSelectFrom = vi.fn(() => ({ selectAll: mockSelectAll }))
  mockedGetDb.mockReturnValue({ selectFrom: mockSelectFrom } as never)
}

function setupContextMocks() {
  mockedFindJob.mockResolvedValue({
    id: 'job-1',
    agent_id: 'agent-1',
    work_item_id: 'wi-1',
    status: 'COMPLETED',
    started_at: 1700000000,
    completed_at: 1700000060,
  } as never)
  mockedFindWorkItem.mockResolvedValue({
    id: 'wi-1',
    title: 'Test Work Item',
    source: 'telegram',
    source_ref: 'chat-123',
  } as never)
  mockedFindAgent.mockResolvedValue({
    id: 'agent-1',
    name: 'Test Agent',
    config: '{}',
  } as never)
  mockedListMessages.mockResolvedValue([
    { role: 'user', content: 'Hello, help me with this' },
    { role: 'assistant', content: 'Sure, I can help with that.' },
  ] as never)
  mockedListInference.mockResolvedValue([{ total_tokens: 500, cost_usd: 0.001 }] as never)
}

describe('eval-worker processEvalRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  it('returns early when no pending eval run to claim', async () => {
    mockedClaimRun.mockResolvedValue(null)

    await processEvalRun()

    expect(mockedUpdateRun).not.toHaveBeenCalled()
  })

  it('marks run as failed when context assembly fails (missing job)', async () => {
    mockedClaimRun.mockResolvedValue(makeEvalRun() as never)
    mockedFindJob.mockResolvedValue(null as never)
    mockedFindWorkItem.mockResolvedValue(null as never)
    mockedFindAgent.mockResolvedValue(null as never)

    await processEvalRun()

    expect(mockedUpdateRun).toHaveBeenCalledWith(
      'run-1',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({
        status: 'failed',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        error_text: expect.stringContaining('Failed to assemble eval context'),
      })
    )
  })

  it('completes with no score when agent has no active evaluators', async () => {
    mockedClaimRun.mockResolvedValue(makeEvalRun() as never)
    setupContextMocks()
    mockedListActive.mockResolvedValue([])

    await processEvalRun()

    expect(mockedUpdateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'completed',
        overall_score: null,
        gates_passed: 1,
      })
    )
  })

  it('processes a scorer evaluator and computes overall score', async () => {
    mockedClaimRun.mockResolvedValue(makeEvalRun() as never)
    setupContextMocks()
    mockedListActive.mockResolvedValue([makeAssignment()] as never)
    mockedGetSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mockedFindRubric.mockResolvedValue({
      id: 'rubric-1',
      criteria_json: JSON.stringify(SAMPLE_CRITERIA),
      judge_model: null,
    } as never)
    setupGatewayMock()
    mockedCreateResult.mockResolvedValue({ id: 'result-1' } as never)
    mockedUpdateRun.mockResolvedValue(null as never)

    const judgeResponse = makeJudgeResponse([
      { id: 'accuracy', name: 'Accuracy', score: 4 },
      { id: 'tone', name: 'Tone', score: 5 },
    ])
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(judgeResponse),
    })

    await processEvalRun()

    // Should create an eval result
    expect(mockedCreateResult).toHaveBeenCalledWith(
      expect.objectContaining({
        eval_run_id: 'run-1',
        evaluator_id: 'ev-1',
        result_type: 'score',
        passed: null,
      })
    )

    // Should complete the run with a score
    expect(mockedUpdateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'completed',
        gates_passed: 1,
      })
    )

    // Verify the overall score was set (weighted average normalized to 0-1)
    const updateCall = mockedUpdateRun.mock.calls.find(
      (call) => (call[1] as Record<string, unknown>).status === 'completed'
    )
    expect(updateCall).toBeDefined()
    const overallScore = (updateCall![1] as Record<string, unknown>).overall_score as number
    expect(overallScore).toBeGreaterThan(0)
    expect(overallScore).toBeLessThanOrEqual(1)
  })

  it('processes a gate evaluator and stops on gate failure', async () => {
    mockedClaimRun.mockResolvedValue(makeEvalRun() as never)
    setupContextMocks()
    // Gate evaluator with is_gate=1 and a scorer after it
    mockedListActive.mockResolvedValue([
      makeAssignment({
        id: 'ae-gate',
        evaluator_id: 'ev-gate',
        is_gate: 1,
        evaluator_name: 'Gate Eval',
      }),
      makeAssignment({
        id: 'ae-scorer',
        evaluator_id: 'ev-scorer',
        is_gate: 0,
        evaluator_name: 'Scorer Eval',
      }),
    ] as never)
    mockedGetSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mockedFindRubric.mockResolvedValue({
      id: 'rubric-1',
      criteria_json: JSON.stringify(SAMPLE_CRITERIA),
      judge_model: null,
    } as never)
    setupGatewayMock()
    mockedCreateResult.mockResolvedValue({ id: 'result-1' } as never)
    mockedUpdateRun.mockResolvedValue(null as never)

    // Gate scores low (all 1s) -> normalized < 0.5 -> gate fails
    const judgeResponse = makeJudgeResponse([
      { id: 'accuracy', name: 'Accuracy', score: 1 },
      { id: 'tone', name: 'Tone', score: 1 },
    ])
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(judgeResponse),
    })

    await processEvalRun()

    // Gate result should be created with passed=0
    expect(mockedCreateResult).toHaveBeenCalledWith(
      expect.objectContaining({
        evaluator_id: 'ev-gate',
        result_type: 'pass_fail',
        passed: 0,
      })
    )

    // Scorer should NOT have been run (gate failed)
    const scorerCall = mockedCreateResult.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).evaluator_id === 'ev-scorer'
    )
    expect(scorerCall).toBeUndefined()

    // Run should be completed with gates_passed=0
    expect(mockedUpdateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'completed',
        gates_passed: 0,
      })
    )
  })

  it('passes gate when score >= 0.5 and runs scorers', async () => {
    mockedClaimRun.mockResolvedValue(makeEvalRun() as never)
    setupContextMocks()
    mockedListActive.mockResolvedValue([
      makeAssignment({
        id: 'ae-gate',
        evaluator_id: 'ev-gate',
        is_gate: 1,
        evaluator_name: 'Gate Eval',
      }),
      makeAssignment({
        id: 'ae-scorer',
        evaluator_id: 'ev-scorer',
        is_gate: 0,
        evaluator_name: 'Scorer Eval',
      }),
    ] as never)
    mockedGetSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mockedFindRubric.mockResolvedValue({
      id: 'rubric-1',
      criteria_json: JSON.stringify(SAMPLE_CRITERIA),
      judge_model: null,
    } as never)
    setupGatewayMock()
    mockedCreateResult.mockResolvedValue({ id: 'result-1' } as never)
    mockedUpdateRun.mockResolvedValue(null as never)

    // High scores -> gate passes
    const judgeResponse = makeJudgeResponse([
      { id: 'accuracy', name: 'Accuracy', score: 5 },
      { id: 'tone', name: 'Tone', score: 4 },
    ])
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(judgeResponse),
    })

    await processEvalRun()

    // Both gate and scorer results should be created (2 calls)
    expect(mockedCreateResult).toHaveBeenCalledTimes(2)
    expect(mockedUpdateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'completed',
        gates_passed: 1,
      })
    )
  })

  it('handles LLM judge returning non-OK HTTP response', async () => {
    mockedClaimRun.mockResolvedValue(makeEvalRun() as never)
    setupContextMocks()
    mockedListActive.mockResolvedValue([makeAssignment()] as never)
    mockedGetSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mockedFindRubric.mockResolvedValue({
      id: 'rubric-1',
      criteria_json: JSON.stringify(SAMPLE_CRITERIA),
      judge_model: null,
    } as never)
    setupGatewayMock()
    mockedUpdateRun.mockResolvedValue(null as never)

    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('Rate limit exceeded'),
    })

    await processEvalRun()

    // Scorer failure should still complete the run (scorers don't block)
    expect(mockedUpdateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'completed',
        gates_passed: 1,
      })
    )
  })

  it('handles LLM judge returning malformed JSON', async () => {
    mockedClaimRun.mockResolvedValue(makeEvalRun() as never)
    setupContextMocks()
    mockedListActive.mockResolvedValue([makeAssignment()] as never)
    mockedGetSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mockedFindRubric.mockResolvedValue({
      id: 'rubric-1',
      criteria_json: JSON.stringify(SAMPLE_CRITERIA),
      judge_model: null,
    } as never)
    setupGatewayMock()
    mockedUpdateRun.mockResolvedValue(null as never)

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: 'NOT VALID JSON {{{' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
    })

    await processEvalRun()

    // Should still complete — scorer failures don't break the pipeline
    expect(mockedUpdateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'completed',
      })
    )
  })

  it('handles LLM judge returning empty choices', async () => {
    mockedClaimRun.mockResolvedValue(makeEvalRun() as never)
    setupContextMocks()
    mockedListActive.mockResolvedValue([makeAssignment()] as never)
    mockedGetSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mockedFindRubric.mockResolvedValue({
      id: 'rubric-1',
      criteria_json: JSON.stringify(SAMPLE_CRITERIA),
      judge_model: null,
    } as never)
    setupGatewayMock()
    mockedUpdateRun.mockResolvedValue(null as never)

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [],
          usage: { prompt_tokens: 100, completion_tokens: 0 },
        }),
    })

    await processEvalRun()

    // Scorer failure is soft — run should still complete
    expect(mockedUpdateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'completed',
      })
    )
  })

  it('handles gate evaluator throwing an error (marks gate failed)', async () => {
    mockedClaimRun.mockResolvedValue(makeEvalRun() as never)
    setupContextMocks()
    mockedListActive.mockResolvedValue([makeAssignment({ is_gate: 1 })] as never)
    mockedGetSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mockedFindRubric.mockResolvedValue({
      id: 'rubric-1',
      criteria_json: JSON.stringify(SAMPLE_CRITERIA),
      judge_model: null,
    } as never)
    setupGatewayMock()
    mockedUpdateRun.mockResolvedValue(null as never)

    // Fetch throws a network error
    mockFetch.mockRejectedValue(new Error('Network failure'))

    await processEvalRun()

    // Gate errors mean gates_passed=0
    expect(mockedUpdateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'completed',
        gates_passed: 0,
      })
    )
  })

  it('respects per-evaluator sample rate for scorers', async () => {
    mockedClaimRun.mockResolvedValue(makeEvalRun() as never)
    setupContextMocks()
    // Scorer with sample_rate=0.0 (always skip)
    mockedListActive.mockResolvedValue([makeAssignment({ sample_rate: 0.0 })] as never)
    mockedGetSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mockedUpdateRun.mockResolvedValue(null as never)
    // Random returns 0, which is >= 0.0, so scorer is skipped
    vi.spyOn(Math, 'random').mockReturnValue(0)

    await processEvalRun()

    // No eval result created (scorer was sampled out)
    expect(mockedCreateResult).not.toHaveBeenCalled()
    // Run still completes
    expect(mockedUpdateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'completed',
        gates_passed: 1,
      })
    )
  })

  it('marks run as failed on unhandled pipeline error', async () => {
    mockedClaimRun.mockResolvedValue(makeEvalRun() as never)
    // Simulate a top-level error in context assembly
    mockedFindJob.mockRejectedValue(new Error('Database connection lost'))
    mockedFindWorkItem.mockRejectedValue(new Error('Database connection lost'))
    mockedFindAgent.mockRejectedValue(new Error('Database connection lost'))
    mockedUpdateRun.mockResolvedValue(null as never)

    await processEvalRun()

    expect(mockedUpdateRun).toHaveBeenCalledWith(
      'run-1',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({
        status: 'failed',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        error_text: expect.stringContaining('Database connection lost'),
      })
    )
  })

  it('skips non-llm_judge evaluator types in scorers phase', async () => {
    mockedClaimRun.mockResolvedValue(makeEvalRun() as never)
    setupContextMocks()
    mockedListActive.mockResolvedValue([
      makeAssignment({ evaluator_type: 'programmatic' }),
    ] as never)
    mockedGetSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mockedUpdateRun.mockResolvedValue(null as never)

    await processEvalRun()

    // No fetch call or result creation for non-llm_judge types
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockedCreateResult).not.toHaveBeenCalled()
    // Run still completes successfully
    expect(mockedUpdateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'completed',
        gates_passed: 1,
      })
    )
  })
})
