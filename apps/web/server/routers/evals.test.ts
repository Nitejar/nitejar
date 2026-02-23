import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nitejar/database', () => ({
  createRubric: vi.fn(),
  findRubricById: vi.fn(),
  updateRubric: vi.fn(),
  deleteRubric: vi.fn(),
  createEvaluator: vi.fn(),
  findEvaluatorById: vi.fn(),
  listEvaluators: vi.fn(),
  updateEvaluator: vi.fn(),
  deleteEvaluator: vi.fn(),
  findEvaluatorByRubricId: vi.fn(),
  assignEvaluatorToAgent: vi.fn(),
  updateAgentEvaluator: vi.fn(),
  removeEvaluatorFromAgent: vi.fn(),
  listAgentEvaluators: vi.fn(),
  findEvalRunById: vi.fn(),
  listEvalRunsByAgent: vi.fn(),
  listEvalRunsByJob: vi.fn(),
  listEvalResultsByRun: vi.fn(),
  getEvalSettings: vi.fn(),
  updateEvalSettings: vi.fn(),
  getScoreTrend: vi.fn(),
  getAgentEvalSummary: vi.fn(),
  getEvalTrendDirection: vi.fn(),
  getEvaluatorStats: vi.fn(),
  findAgentById: vi.fn(),
  listRecentEvalRuns: vi.fn(),
  getFleetEvalSummary: vi.fn(),
  getFleetScoreTrend: vi.fn(),
  getPerAgentEvalStats: vi.fn(),
}))

import {
  createRubric,
  findRubricById,
  updateRubric,
  deleteRubric,
  createEvaluator,
  findEvaluatorById,
  listEvaluators,
  updateEvaluator,
  deleteEvaluator,
  findEvaluatorByRubricId,
  assignEvaluatorToAgent,
  updateAgentEvaluator,
  removeEvaluatorFromAgent,
  listAgentEvaluators,
  findEvalRunById,
  listEvalRunsByAgent,
  listEvalRunsByJob,
  listEvalResultsByRun,
  getEvalSettings,
  updateEvalSettings,
  getScoreTrend,
  getAgentEvalSummary,
  getEvalTrendDirection,
  getEvaluatorStats,
  findAgentById,
  listRecentEvalRuns,
  getFleetEvalSummary,
  getFleetScoreTrend,
  getPerAgentEvalStats,
} from '@nitejar/database'
import { evalsRouter } from './evals'

const mockedCreateRubric = vi.mocked(createRubric)
const mockedFindRubricById = vi.mocked(findRubricById)
const mockedUpdateRubric = vi.mocked(updateRubric)
const mockedDeleteRubric = vi.mocked(deleteRubric)
const mockedCreateEvaluator = vi.mocked(createEvaluator)
const mockedFindEvaluatorById = vi.mocked(findEvaluatorById)
const mockedListEvaluators = vi.mocked(listEvaluators)
const mockedUpdateEvaluator = vi.mocked(updateEvaluator)
const mockedDeleteEvaluator = vi.mocked(deleteEvaluator)
const mockedFindEvaluatorByRubricId = vi.mocked(findEvaluatorByRubricId)
const mockedAssignEvaluatorToAgent = vi.mocked(assignEvaluatorToAgent)
const mockedUpdateAgentEvaluator = vi.mocked(updateAgentEvaluator)
const mockedRemoveEvaluatorFromAgent = vi.mocked(removeEvaluatorFromAgent)
const mockedListAgentEvaluators = vi.mocked(listAgentEvaluators)
const mockedFindEvalRunById = vi.mocked(findEvalRunById)
const mockedListEvalRunsByAgent = vi.mocked(listEvalRunsByAgent)
const mockedListEvalRunsByJob = vi.mocked(listEvalRunsByJob)
const mockedListEvalResultsByRun = vi.mocked(listEvalResultsByRun)
const mockedGetEvalSettings = vi.mocked(getEvalSettings)
const mockedUpdateEvalSettings = vi.mocked(updateEvalSettings)
const mockedGetScoreTrend = vi.mocked(getScoreTrend)
const mockedGetAgentEvalSummary = vi.mocked(getAgentEvalSummary)
const mockedGetEvalTrendDirection = vi.mocked(getEvalTrendDirection)
const mockedGetEvaluatorStats = vi.mocked(getEvaluatorStats)
const mockedFindAgentById = vi.mocked(findAgentById)
const mockedListRecentEvalRuns = vi.mocked(listRecentEvalRuns)
const mockedGetFleetEvalSummary = vi.mocked(getFleetEvalSummary)
const mockedGetFleetScoreTrend = vi.mocked(getFleetScoreTrend)
const mockedGetPerAgentEvalStats = vi.mocked(getPerAgentEvalStats)

const caller = evalsRouter.createCaller({
  session: { user: { id: 'user-1' } } as never,
})

function makeEvaluator(overrides = {}) {
  return {
    id: 'ev-1',
    name: 'Test Evaluator',
    description: 'A test evaluator',
    type: 'llm_judge',
    config_json: JSON.stringify({ rubric_id: 'rubric-1' }),
    judge_model: null,
    created_at: 1700000000,
    updated_at: 1700000000,
    ...overrides,
  }
}

function makeRubric(overrides = {}) {
  return {
    id: 'rubric-1',
    name: 'Test Rubric',
    description: 'A test rubric',
    criteria_json: JSON.stringify([]),
    version: 1,
    judge_model: null,
    created_by: 'admin',
    created_at: 1700000000,
    updated_at: 1700000000,
    ...overrides,
  }
}

function makeEvalRun(overrides = {}) {
  return {
    id: 'run-1',
    job_id: 'job-1',
    agent_id: 'agent-1',
    work_item_id: 'wi-1',
    trigger: 'auto',
    status: 'completed',
    overall_score: 0.75,
    gates_passed: 1,
    pipeline_result_json: null,
    total_cost_usd: 0.001,
    error_text: null,
    started_at: 1700000000,
    completed_at: 1700000060,
    created_at: 1700000000,
    updated_at: 1700000060,
    ...overrides,
  }
}

describe('evals router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Evaluator CRUD
  // --------------------------------------------------------------------------

  describe('evaluator CRUD', () => {
    it('listEvaluators returns all evaluators', async () => {
      mockedListEvaluators.mockResolvedValue([makeEvaluator()] as never)
      const result = await caller.listEvaluators()
      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Test Evaluator')
    })

    it('listEvaluators filters by agentId when provided', async () => {
      mockedListEvaluators.mockResolvedValue([
        makeEvaluator({ id: 'ev-1' }),
        makeEvaluator({ id: 'ev-2', name: 'Other' }),
      ] as never)
      mockedListAgentEvaluators.mockResolvedValue([{ evaluator_id: 'ev-1' }] as never)

      const result = await caller.listEvaluators({ agentId: 'agent-1' })
      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('ev-1')
    })

    it('getEvaluator throws NOT_FOUND for unknown ID', async () => {
      mockedFindEvaluatorById.mockResolvedValue(null)
      await expect(caller.getEvaluator({ id: 'unknown' })).rejects.toThrow('Evaluator not found')
    })

    it('createEvaluator passes correct args to DB', async () => {
      mockedCreateEvaluator.mockResolvedValue(makeEvaluator() as never)

      const result = await caller.createEvaluator({
        name: 'New Evaluator',
        type: 'llm_judge',
        configJson: { rubric_id: 'rubric-1' },
      })

      expect(mockedCreateEvaluator).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Evaluator',
          type: 'llm_judge',
          config_json: JSON.stringify({ rubric_id: 'rubric-1' }),
        })
      )
      expect(result.id).toBe('ev-1')
    })

    it('deleteEvaluator throws NOT_FOUND when evaluator does not exist', async () => {
      mockedDeleteEvaluator.mockResolvedValue(false)
      await expect(caller.deleteEvaluator({ id: 'unknown' })).rejects.toThrow('Evaluator not found')
    })

    it('deleteEvaluator returns success when evaluator exists', async () => {
      mockedDeleteEvaluator.mockResolvedValue(true)
      const result = await caller.deleteEvaluator({ id: 'ev-1' })
      expect(result.success).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // Agent-Evaluator Assignments
  // --------------------------------------------------------------------------

  describe('agent-evaluator assignments', () => {
    it('assignEvaluatorToAgent validates agent and evaluator exist', async () => {
      mockedFindAgentById.mockResolvedValue(null as never)
      await expect(
        caller.assignEvaluatorToAgent({ agentId: 'bad', evaluatorId: 'ev-1' })
      ).rejects.toThrow('Agent not found')

      mockedFindAgentById.mockResolvedValue({ id: 'agent-1' } as never)
      mockedFindEvaluatorById.mockResolvedValue(null)
      await expect(
        caller.assignEvaluatorToAgent({ agentId: 'agent-1', evaluatorId: 'bad' })
      ).rejects.toThrow('Evaluator not found')
    })

    it('assignEvaluatorToAgent returns assignment on success', async () => {
      mockedFindAgentById.mockResolvedValue({ id: 'agent-1' } as never)
      mockedFindEvaluatorById.mockResolvedValue(makeEvaluator() as never)
      mockedAssignEvaluatorToAgent.mockResolvedValue({
        id: 'ae-1',
        agent_id: 'agent-1',
        evaluator_id: 'ev-1',
        weight: 1.0,
        is_active: 1,
        is_gate: 0,
      } as never)

      const result = await caller.assignEvaluatorToAgent({
        agentId: 'agent-1',
        evaluatorId: 'ev-1',
      })
      expect(result.id).toBe('ae-1')
    })

    it('assignEvaluatorToAgent wraps unique constraint errors', async () => {
      mockedFindAgentById.mockResolvedValue({ id: 'agent-1' } as never)
      mockedFindEvaluatorById.mockResolvedValue(makeEvaluator() as never)
      mockedAssignEvaluatorToAgent.mockRejectedValue(new Error('UNIQUE constraint failed'))

      await expect(
        caller.assignEvaluatorToAgent({ agentId: 'agent-1', evaluatorId: 'ev-1' })
      ).rejects.toThrow('Evaluator is already assigned to this agent')
    })

    it('updateAgentEvaluator throws NOT_FOUND when assignment missing', async () => {
      mockedUpdateAgentEvaluator.mockResolvedValue(null)
      await expect(caller.updateAgentEvaluator({ id: 'unknown', weight: 2 })).rejects.toThrow(
        'Agent evaluator assignment not found'
      )
    })

    it('removeEvaluatorFromAgent throws NOT_FOUND when missing', async () => {
      mockedRemoveEvaluatorFromAgent.mockResolvedValue(false)
      await expect(caller.removeEvaluatorFromAgent({ id: 'unknown' })).rejects.toThrow(
        'Agent evaluator assignment not found'
      )
    })
  })

  // --------------------------------------------------------------------------
  // Rubric CRUD
  // --------------------------------------------------------------------------

  describe('rubric CRUD', () => {
    it('createRubric creates both rubric and evaluator', async () => {
      mockedCreateRubric.mockResolvedValue(makeRubric() as never)
      mockedCreateEvaluator.mockResolvedValue(makeEvaluator() as never)

      const result = await caller.createRubric({
        name: 'New Rubric',
        criteriaJson: [
          {
            id: 'c1',
            name: 'Criterion',
            description: 'Test',
            weight: 1,
            scale: { 1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e' },
          },
        ],
      })

      expect(result.rubric.id).toBe('rubric-1')
      expect(result.evaluator.id).toBe('ev-1')
      expect(mockedCreateEvaluator).toHaveBeenCalledWith(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({
          type: 'llm_judge',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          config_json: expect.stringContaining('rubric-1'),
        })
      )
    })

    it('getRubric throws NOT_FOUND for unknown rubric', async () => {
      mockedFindRubricById.mockResolvedValue(null)
      await expect(caller.getRubric({ id: 'unknown' })).rejects.toThrow('Rubric not found')
    })

    it('updateRubric also updates associated evaluator', async () => {
      mockedUpdateRubric.mockResolvedValue(makeRubric({ name: 'Updated' }) as never)
      mockedFindEvaluatorByRubricId.mockResolvedValue(makeEvaluator() as never)

      await caller.updateRubric({ id: 'rubric-1', name: 'Updated' })

      expect(mockedUpdateEvaluator).toHaveBeenCalledWith(
        'ev-1',
        expect.objectContaining({ name: 'Updated' })
      )
    })

    it('deleteRubric also deletes associated evaluator', async () => {
      mockedFindEvaluatorByRubricId.mockResolvedValue(makeEvaluator() as never)
      mockedDeleteEvaluator.mockResolvedValue(true)
      mockedDeleteRubric.mockResolvedValue(true)

      const result = await caller.deleteRubric({ id: 'rubric-1' })
      expect(result.success).toBe(true)
      expect(mockedDeleteEvaluator).toHaveBeenCalledWith('ev-1')
    })
  })

  // --------------------------------------------------------------------------
  // Templates
  // --------------------------------------------------------------------------

  describe('templates', () => {
    it('listTemplates returns all 4 built-in templates', async () => {
      const templates = await caller.listTemplates()
      expect(templates).toHaveLength(4)
      const ids = templates.map((t) => t.id)
      expect(ids).toContain('general-assistant')
      expect(ids).toContain('code-review')
      expect(ids).toContain('customer-support')
      expect(ids).toContain('research-analysis')
    })

    it('createFromTemplate throws for unknown template', async () => {
      await expect(caller.createFromTemplate({ templateId: 'not-real' })).rejects.toThrow(
        'Template not found'
      )
    })

    it('createFromTemplate creates rubric + evaluator', async () => {
      mockedCreateRubric.mockResolvedValue(makeRubric({ name: 'General Assistant' }) as never)
      mockedCreateEvaluator.mockResolvedValue(makeEvaluator({ name: 'General Assistant' }) as never)

      const result = await caller.createFromTemplate({ templateId: 'general-assistant' })
      expect(result.rubric.name).toBe('General Assistant')
      expect(result.evaluator.name).toBe('General Assistant')
    })

    it('createFromTemplate assigns to agent when agentId provided', async () => {
      mockedCreateRubric.mockResolvedValue(makeRubric() as never)
      mockedCreateEvaluator.mockResolvedValue(makeEvaluator() as never)
      mockedFindAgentById.mockResolvedValue({ id: 'agent-1' } as never)
      mockedAssignEvaluatorToAgent.mockResolvedValue({ id: 'ae-1' } as never)

      await caller.createFromTemplate({ templateId: 'general-assistant', agentId: 'agent-1' })

      expect(mockedAssignEvaluatorToAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agent_id: 'agent-1',
          evaluator_id: 'ev-1',
        })
      )
    })
  })

  // --------------------------------------------------------------------------
  // Eval Runs
  // --------------------------------------------------------------------------

  describe('eval runs', () => {
    it('getEvalRun returns run with results', async () => {
      mockedFindEvalRunById.mockResolvedValue(makeEvalRun() as never)
      mockedListEvalResultsByRun.mockResolvedValue([{ id: 'result-1', score: 0.8 }] as never)

      const result = await caller.getEvalRun({ id: 'run-1' })
      expect(result.id).toBe('run-1')
      expect(result.results).toHaveLength(1)
    })

    it('getEvalRun throws NOT_FOUND for unknown run', async () => {
      mockedFindEvalRunById.mockResolvedValue(null)
      await expect(caller.getEvalRun({ id: 'unknown' })).rejects.toThrow('Eval run not found')
    })

    it('listEvalRuns with agentId paginates correctly', async () => {
      const runs = Array.from({ length: 4 }, (_, i) =>
        makeEvalRun({ id: `run-${i}`, created_at: 1700000000 + i })
      )
      // Return 4 items when limit is 3 (extra 1 signals "has more")
      mockedListEvalRunsByAgent.mockResolvedValue(runs as never)

      const result = await caller.listEvalRuns({ agentId: 'agent-1', limit: 3 })
      expect(result.runs).toHaveLength(3)
      expect(result.nextCursor).toBeDefined()
      expect(result.nextCursor!.id).toBe('run-2')
    })

    it('listEvalRuns with agentId returns null cursor when no more pages', async () => {
      mockedListEvalRunsByAgent.mockResolvedValue([makeEvalRun()] as never)
      const result = await caller.listEvalRuns({ agentId: 'agent-1', limit: 10 })
      expect(result.runs).toHaveLength(1)
      expect(result.nextCursor).toBeNull()
    })

    it('listEvalRuns without agentId uses fleet-wide query', async () => {
      const runs = [
        { ...makeEvalRun({ id: 'run-1' }), agent_name: 'Agent A' },
        { ...makeEvalRun({ id: 'run-2' }), agent_name: 'Agent B' },
      ]
      mockedListRecentEvalRuns.mockResolvedValue(runs as never)

      const result = await caller.listEvalRuns({ limit: 10 })
      expect(result.runs).toHaveLength(2)
      expect(result.runs[0]!.agent_name).toBe('Agent A')
      expect(result.runs[1]!.agent_name).toBe('Agent B')
      expect(mockedListRecentEvalRuns).toHaveBeenCalledWith(expect.objectContaining({ limit: 11 }))
      expect(mockedListEvalRunsByAgent).not.toHaveBeenCalled()
    })

    it('listEvalRuns without agentId paginates correctly', async () => {
      const runs = Array.from({ length: 4 }, (_, i) => ({
        ...makeEvalRun({ id: `run-${i}`, created_at: 1700000000 + i }),
        agent_name: 'Agent A',
      }))
      mockedListRecentEvalRuns.mockResolvedValue(runs as never)

      const result = await caller.listEvalRuns({ limit: 3 })
      expect(result.runs).toHaveLength(3)
      expect(result.nextCursor).toBeDefined()
      expect(result.nextCursor!.id).toBe('run-2')
    })

    it('getEvalsForJob returns runs with their results', async () => {
      mockedListEvalRunsByJob.mockResolvedValue([makeEvalRun()] as never)
      mockedListEvalResultsByRun.mockResolvedValue([{ id: 'r1', score: 0.8 }] as never)

      const result = await caller.getEvalsForJob({ jobId: 'job-1' })
      expect(result).toHaveLength(1)
      expect(result[0]!.results).toHaveLength(1)
    })
  })

  // --------------------------------------------------------------------------
  // Summary and Trends
  // --------------------------------------------------------------------------

  describe('summary and trends', () => {
    it('getAgentEvalSummary computes trend direction', async () => {
      mockedGetAgentEvalSummary.mockResolvedValue({
        totalEvals: 10,
        avgOverallScore: 0.75,
        gatePassRate: 0.9,
        lastEvalAt: 1700000000,
        evalCostTotal: 0.05,
      })
      mockedGetEvalTrendDirection.mockResolvedValue({
        recentAvg: 0.8,
        recentCount: 5,
        previousAvg: 0.7,
        previousCount: 5,
      })
      mockedListAgentEvaluators.mockResolvedValue([])
      const result = await caller.getAgentEvalSummary({ agentId: 'agent-1' })
      expect(result.recentTrend).toBe('improving')
    })

    it('getAgentEvalSummary returns stable when delta is small', async () => {
      mockedGetAgentEvalSummary.mockResolvedValue({
        totalEvals: 10,
        avgOverallScore: 0.75,
        gatePassRate: 0.9,
        lastEvalAt: 1700000000,
        evalCostTotal: 0.05,
      })
      mockedGetEvalTrendDirection.mockResolvedValue({
        recentAvg: 0.75,
        recentCount: 5,
        previousAvg: 0.74,
        previousCount: 5,
      })
      mockedListAgentEvaluators.mockResolvedValue([])
      const result = await caller.getAgentEvalSummary({ agentId: 'agent-1' })
      expect(result.recentTrend).toBe('stable')
    })

    it('getAgentEvalSummary returns declining when score drops', async () => {
      mockedGetAgentEvalSummary.mockResolvedValue({
        totalEvals: 10,
        avgOverallScore: 0.6,
        gatePassRate: 0.8,
        lastEvalAt: 1700000000,
        evalCostTotal: 0.05,
      })
      mockedGetEvalTrendDirection.mockResolvedValue({
        recentAvg: 0.5,
        recentCount: 5,
        previousAvg: 0.7,
        previousCount: 5,
      })
      mockedListAgentEvaluators.mockResolvedValue([])
      const result = await caller.getAgentEvalSummary({ agentId: 'agent-1' })
      expect(result.recentTrend).toBe('declining')
    })

    it('getAgentEvalSummary returns insufficient_data with too few runs', async () => {
      mockedGetAgentEvalSummary.mockResolvedValue({
        totalEvals: 2,
        avgOverallScore: 0.75,
        gatePassRate: 1.0,
        lastEvalAt: 1700000000,
        evalCostTotal: 0.01,
      })
      mockedGetEvalTrendDirection.mockResolvedValue({
        recentAvg: 0.8,
        recentCount: 2,
        previousAvg: null,
        previousCount: 0,
      })
      mockedListAgentEvaluators.mockResolvedValue([])
      const result = await caller.getAgentEvalSummary({ agentId: 'agent-1' })
      expect(result.recentTrend).toBe('insufficient_data')
    })

    it('getAgentEvalSummary includes evaluator breakdown', async () => {
      mockedGetAgentEvalSummary.mockResolvedValue({
        totalEvals: 10,
        avgOverallScore: 0.75,
        gatePassRate: 0.9,
        lastEvalAt: 1700000000,
        evalCostTotal: 0.05,
      })
      mockedGetEvalTrendDirection.mockResolvedValue({
        recentAvg: 0.75,
        recentCount: 5,
        previousAvg: 0.75,
        previousCount: 5,
      })
      mockedListAgentEvaluators.mockResolvedValue([
        {
          evaluator_id: 'ev-1',
          evaluator_name: 'Quality',
          evaluator_type: 'llm_judge',
          is_gate: 0,
          weight: 2,
        },
        {
          evaluator_id: 'ev-2',
          evaluator_name: 'Safety Gate',
          evaluator_type: 'llm_judge',
          is_gate: 1,
          weight: 1,
        },
      ] as never)
      mockedGetEvaluatorStats.mockResolvedValue({
        avgScore: 0.8,
        evalCount: 5,
        passCount: 4,
      })

      const result = await caller.getAgentEvalSummary({ agentId: 'agent-1' })
      expect(result.evaluatorBreakdown).toHaveLength(2)

      const scorer = result.evaluatorBreakdown.find((e) => !e.isGate)
      expect(scorer).toBeDefined()
      expect(scorer!.avgScore).toBe(0.8)
      expect(scorer!.normalizedWeight).toBe(1) // only scorer, gets 100%

      const gate = result.evaluatorBreakdown.find((e) => e.isGate)
      expect(gate).toBeDefined()
      expect(gate!.passRate).toBe(0.8) // 4/5
      expect(gate!.normalizedWeight).toBe(0)
    })

    it('getScoreTrend with agentId passes options through', async () => {
      mockedGetScoreTrend.mockResolvedValue([])
      await caller.getScoreTrend({ agentId: 'agent-1', days: 14, granularity: 'week' })
      expect(mockedGetScoreTrend).toHaveBeenCalledWith('agent-1', {
        days: 14,
        granularity: 'week',
        evaluatorId: undefined,
        evaluatorType: undefined,
      })
    })

    it('getScoreTrend without agentId uses fleet-wide query', async () => {
      mockedGetFleetScoreTrend.mockResolvedValue([
        { date: '2026-02-01', avg_score: 0.8, eval_count: 5 },
      ])
      const result = await caller.getScoreTrend({ days: 14 })
      expect(result).toHaveLength(1)
      expect(mockedGetFleetScoreTrend).toHaveBeenCalledWith({ days: 14 })
      expect(mockedGetScoreTrend).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Fleet-wide aggregation
  // --------------------------------------------------------------------------

  describe('fleet-wide aggregation', () => {
    it('getFleetEvalSummary returns fleet-wide stats', async () => {
      mockedGetFleetEvalSummary.mockResolvedValue({
        totalEvals: 42,
        avgOverallScore: 0.82,
        gatePassRate: 0.95,
        lastEvalAt: 1700000000,
        evalCostTotal: 0.25,
      })

      const result = await caller.getFleetEvalSummary()
      expect(result.totalEvals).toBe(42)
      expect(result.avgOverallScore).toBe(0.82)
      expect(result.gatePassRate).toBe(0.95)
      expect(result.evalCostTotal).toBe(0.25)
    })

    it('getFleetPerAgentStats returns per-agent breakdown', async () => {
      mockedGetPerAgentEvalStats.mockResolvedValue([
        {
          agent_id: 'agent-1',
          agent_name: 'Agent A',
          total_evals: 20,
          avg_score: 0.85,
          gate_pass_rate: 0.9,
          last_eval_at: 1700000000,
          eval_cost: 0.1,
        },
        {
          agent_id: 'agent-2',
          agent_name: 'Agent B',
          total_evals: 22,
          avg_score: 0.78,
          gate_pass_rate: 1.0,
          last_eval_at: 1700000000,
          eval_cost: 0.15,
        },
      ])

      const result = await caller.getFleetPerAgentStats()
      expect(result).toHaveLength(2)
      expect(result[0]!.agent_name).toBe('Agent A')
      expect(result[1]!.agent_name).toBe('Agent B')
      expect(result[0]!.total_evals).toBe(20)
    })
  })

  // --------------------------------------------------------------------------
  // Settings
  // --------------------------------------------------------------------------

  describe('settings', () => {
    it('getSettings returns eval settings', async () => {
      mockedGetEvalSettings.mockResolvedValue({
        id: 'default',
        judge_model: 'openai/gpt-4o-mini',
        max_daily_evals: 50,
        sample_rate_default: 1.0,
        sample_rate_high_volume_threshold: 20,
        sample_rate_high_volume: 0.2,
        eval_cost_budget_usd: null,
        created_at: 1700000000,
        updated_at: 1700000000,
      })
      const result = await caller.getSettings()
      expect(result.max_daily_evals).toBe(50)
    })

    it('updateSettings maps camelCase input to snake_case DB fields', async () => {
      mockedUpdateEvalSettings.mockResolvedValue({ id: 'default' } as never)

      await caller.updateSettings({
        judgeModel: 'anthropic/claude-3.5-haiku',
        maxDailyEvals: 100,
        sampleRateDefault: 0.8,
      })

      expect(mockedUpdateEvalSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          judge_model: 'anthropic/claude-3.5-haiku',
          max_daily_evals: 100,
          sample_rate_default: 0.8,
        })
      )
    })
  })

  // --------------------------------------------------------------------------
  // Assign Rubric to Agent (convenience)
  // --------------------------------------------------------------------------

  describe('assignRubricToAgent', () => {
    it('creates evaluator if none exists for rubric', async () => {
      mockedFindAgentById.mockResolvedValue({ id: 'agent-1' } as never)
      mockedFindRubricById.mockResolvedValue(makeRubric() as never)
      mockedFindEvaluatorByRubricId.mockResolvedValue(null)
      mockedCreateEvaluator.mockResolvedValue(makeEvaluator() as never)
      mockedAssignEvaluatorToAgent.mockResolvedValue({ id: 'ae-1' } as never)

      await caller.assignRubricToAgent({ agentId: 'agent-1', rubricId: 'rubric-1' })

      expect(mockedCreateEvaluator).toHaveBeenCalledWith(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({
          type: 'llm_judge',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          config_json: expect.stringContaining('rubric-1'),
        })
      )
      expect(mockedAssignEvaluatorToAgent).toHaveBeenCalled()
    })

    it('reuses existing evaluator for rubric', async () => {
      mockedFindAgentById.mockResolvedValue({ id: 'agent-1' } as never)
      mockedFindRubricById.mockResolvedValue(makeRubric() as never)
      mockedFindEvaluatorByRubricId.mockResolvedValue(makeEvaluator() as never)
      mockedAssignEvaluatorToAgent.mockResolvedValue({ id: 'ae-1' } as never)

      await caller.assignRubricToAgent({ agentId: 'agent-1', rubricId: 'rubric-1' })

      expect(mockedCreateEvaluator).not.toHaveBeenCalled()
      expect(mockedAssignEvaluatorToAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          evaluator_id: 'ev-1',
        })
      )
    })
  })
})
