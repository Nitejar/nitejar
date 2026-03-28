import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Database from '@nitejar/database'
import type { ToolContext } from './tools'
import {
  createRubricTool,
  runEvalForJobTool,
  updateAgentEvalAssignmentTool,
} from './tools/handlers/evals'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    assertAgentGrant: vi.fn(),
    createEvalRun: vi.fn(),
    createEvaluator: vi.fn(),
    createRubric: vi.fn(),
    findAgentById: vi.fn(),
    findEvaluatorById: vi.fn(),
    findEvaluatorByRubricId: vi.fn(),
    findEvalRunById: vi.fn(),
    findJobById: vi.fn(),
    findRubricById: vi.fn(),
    getAgentEvalSummary: vi.fn(),
    getEvalSettings: vi.fn(),
    getEvaluatorStats: vi.fn(),
    getEvalTrendDirection: vi.fn(),
    getFleetEvalSummary: vi.fn(),
    getPerAgentEvalStats: vi.fn(),
    listAgentEvaluators: vi.fn(),
    listEvalResultsByRun: vi.fn(),
    listEvalRunsByAgent: vi.fn(),
    listRecentEvalRuns: vi.fn(),
    listRubrics: vi.fn(),
    updateAgentEvaluator: vi.fn(),
    updateEvaluator: vi.fn(),
    updateEvalSettings: vi.fn(),
    updateRubric: vi.fn(),
    deleteEvaluator: vi.fn(),
    deleteRubric: vi.fn(),
    assignEvaluatorToAgent: vi.fn(),
  }
})

const mockedAssertAgentGrant = vi.mocked(Database.assertAgentGrant)
const mockedCreateEvalRun = vi.mocked(Database.createEvalRun)
const mockedCreateEvaluator = vi.mocked(Database.createEvaluator)
const mockedCreateRubric = vi.mocked(Database.createRubric)
const mockedFindAgentById = vi.mocked(Database.findAgentById)
const mockedFindEvaluatorByRubricId = vi.mocked(Database.findEvaluatorByRubricId)
const mockedFindJobById = vi.mocked(Database.findJobById)
const mockedFindRubricById = vi.mocked(Database.findRubricById)
const mockedListAgentEvaluators = vi.mocked(Database.listAgentEvaluators)
const mockedAssignEvaluatorToAgent = vi.mocked(Database.assignEvaluatorToAgent)

const context: ToolContext = {
  agentId: 'agent-ceo',
  spriteName: 'nitejar-ceo',
}

describe('eval agent tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedAssertAgentGrant.mockResolvedValue(undefined)
  })

  it('create_rubric creates a rubric and linked evaluator', async () => {
    mockedCreateRubric.mockResolvedValue({
      id: 'rubric-1',
      name: 'Quality',
      description: null,
      criteria_json: '[]',
      version: 1,
      judge_model: null,
      created_by: 'agent',
      created_at: 1,
      updated_at: 1,
    } as never)
    mockedCreateEvaluator.mockResolvedValue({
      id: 'ev-1',
      name: 'Quality',
      description: null,
      type: 'llm_judge',
      config_json: JSON.stringify({ rubric_id: 'rubric-1' }),
      judge_model: null,
      created_at: 1,
      updated_at: 1,
    } as never)

    const result = await createRubricTool(
      {
        name: 'Quality',
        criteria: [
          {
            id: 'c1',
            name: 'Accuracy',
            description: 'Be right',
            weight: 1,
            scale: { 1: 'bad', 2: 'weak', 3: 'ok', 4: 'good', 5: 'great' },
          },
        ],
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedCreateRubric).toHaveBeenCalled()
    expect(mockedCreateEvaluator).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'llm_judge' })
    )
    const createEvaluatorCall = mockedCreateEvaluator.mock.calls[0]?.[0]
    expect(createEvaluatorCall).toBeDefined()
    expect(createEvaluatorCall?.config_json).toContain('rubric-1')
  })

  it('update_agent_eval_assignment creates a rubric assignment when missing', async () => {
    mockedFindAgentById.mockResolvedValue({ id: 'agent-1' } as never)
    mockedFindRubricById.mockResolvedValue({
      id: 'rubric-1',
      name: 'Quality',
      description: 'Test rubric',
      criteria_json: '[]',
      version: 1,
      judge_model: null,
      created_by: 'agent',
      created_at: 1,
      updated_at: 1,
    } as never)
    mockedFindEvaluatorByRubricId.mockResolvedValue({
      id: 'ev-1',
      name: 'Quality',
      description: 'Test rubric',
      type: 'llm_judge',
      config_json: JSON.stringify({ rubric_id: 'rubric-1' }),
      judge_model: null,
      created_at: 1,
      updated_at: 1,
    } as never)
    mockedListAgentEvaluators.mockResolvedValue([] as never)
    mockedAssignEvaluatorToAgent.mockResolvedValue({
      id: 'ae-1',
      agent_id: 'agent-1',
      evaluator_id: 'ev-1',
      weight: 1,
      is_active: 1,
      is_gate: 0,
      sample_rate: null,
      created_at: 1,
      updated_at: 1,
    } as never)

    const result = await updateAgentEvalAssignmentTool(
      { agent_id: 'agent-1', rubric_id: 'rubric-1', weight: 2 },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedAssignEvaluatorToAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'agent-1',
        evaluator_id: 'ev-1',
        weight: 2,
      })
    )
  })

  it('run_eval_for_job rejects non-completed jobs and enqueues manual runs for completed jobs', async () => {
    mockedFindJobById.mockResolvedValueOnce({
      id: 'job-1',
      status: 'RUNNING',
      agent_id: 'agent-1',
      work_item_id: 'work-1',
    } as never)

    const rejected = await runEvalForJobTool({ job_id: 'job-1' }, context)
    expect(rejected.success).toBe(false)
    expect(rejected.error).toContain('completed jobs')

    mockedFindJobById.mockResolvedValueOnce({
      id: 'job-2',
      status: 'COMPLETED',
      agent_id: 'agent-1',
      work_item_id: 'work-2',
    } as never)
    mockedCreateEvalRun.mockResolvedValue({
      id: 'eval-run-1',
      job_id: 'job-2',
      agent_id: 'agent-1',
      work_item_id: 'work-2',
      trigger: 'manual',
      status: 'pending',
      overall_score: null,
      gates_passed: null,
      pipeline_result_json: null,
      total_cost_usd: null,
      error_text: null,
      started_at: null,
      completed_at: null,
      created_at: 1,
      updated_at: 1,
    } as never)

    const accepted = await runEvalForJobTool({ job_id: 'job-2' }, context)
    expect(accepted.success).toBe(true)
    expect(mockedCreateEvalRun).toHaveBeenCalledWith(
      expect.objectContaining({
        job_id: 'job-2',
        trigger: 'manual',
        status: 'pending',
      })
    )
  })
})
