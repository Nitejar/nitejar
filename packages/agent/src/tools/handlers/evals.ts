import type Anthropic from '@anthropic-ai/sdk'
import {
  assertAgentGrant,
  createEvalRun,
  createEvaluator,
  createRubric,
  findAgentById,
  findEvaluatorById,
  findEvaluatorByRubricId,
  findEvalRunById,
  findJobById,
  findRubricById,
  getAgentEvalSummary,
  getEvalSettings,
  getEvaluatorStats,
  getEvalTrendDirection,
  getFleetEvalSummary,
  getPerAgentEvalStats,
  listAgentEvaluators,
  listEvalResultsByRun,
  listEvalRunsByAgent,
  listRecentEvalRuns,
  listRubrics,
  updateAgentEvaluator,
  updateEvaluator,
  updateEvalSettings,
  updateRubric,
  deleteEvaluator,
  deleteRubric,
  assignEvaluatorToAgent,
} from '@nitejar/database'
import type { ToolHandler } from '../types'

type RubricCriterion = {
  id: string
  name: string
  description: string
  weight: number
  scale: Record<1 | 2 | 3 | 4 | 5, string>
}

type CursorValue = { createdAt: number; id: string }

const RUBRIC_TEMPLATES: Array<{
  id: string
  name: string
  description: string
  criteria: RubricCriterion[]
}> = [
  {
    id: 'general-assistant',
    name: 'General Assistant',
    description:
      'Default rubric for most agents — covers accuracy, helpfulness, tone, and efficiency.',
    criteria: [
      {
        id: 'accuracy',
        name: 'Accuracy',
        description: 'How factually correct and technically accurate is the response?',
        weight: 3,
        scale: {
          1: 'Response contains fabricated or dangerously wrong information',
          2: 'Multiple factual errors that undermine usefulness',
          3: 'Mostly correct but with notable gaps or inaccuracies',
          4: 'Accurate with at most minor, non-critical imprecisions',
          5: 'Fully accurate, well-sourced, no errors detected',
        },
      },
      {
        id: 'helpfulness',
        name: 'Helpfulness',
        description: "Did the response actually solve or advance the user's problem?",
        weight: 3,
        scale: {
          1: "Response does not address the user's question at all",
          2: 'Tangentially related but does not solve the problem',
          3: 'Partially addresses the problem, user still needs significant help',
          4: 'Substantially solves the problem with minor follow-up needed',
          5: "Completely resolves the user's issue, actionable and clear",
        },
      },
      {
        id: 'tone',
        name: 'Tone & Communication',
        description: 'Is the communication style appropriate for the context?',
        weight: 2,
        scale: {
          1: 'Rude, dismissive, or inappropriately formal/casual',
          2: 'Awkward tone that detracts from the message',
          3: 'Acceptable but generic, no personality',
          4: 'Natural and appropriate, consistent with agent personality',
          5: 'Excellent tone that builds rapport while staying professional',
        },
      },
      {
        id: 'efficiency',
        name: 'Efficiency',
        description: 'Did the agent use its tools and context window efficiently?',
        weight: 1,
        scale: {
          1: 'Excessive tool calls, wasted tokens, or circular reasoning',
          2: 'Notably inefficient but eventually completed the task',
          3: 'Adequate efficiency, some unnecessary steps',
          4: 'Efficient execution with minor optimization opportunities',
          5: 'Optimal tool usage, minimal wasted tokens, direct path to solution',
        },
      },
    ],
  },
  {
    id: 'code-review',
    name: 'Code Review',
    description:
      'Rubric for GitHub-focused agents — covers correctness, thoroughness, actionability, and tone.',
    criteria: [
      {
        id: 'correctness',
        name: 'Correctness',
        description: 'Are the code suggestions and analysis technically correct?',
        weight: 3,
        scale: {
          1: 'Suggestions would introduce bugs or are fundamentally wrong',
          2: 'Multiple incorrect suggestions mixed with some valid ones',
          3: 'Mostly correct analysis with some questionable suggestions',
          4: 'Accurate analysis with minor edge cases missed',
          5: 'All suggestions are technically sound and well-reasoned',
        },
      },
      {
        id: 'thoroughness',
        name: 'Thoroughness',
        description: 'Did the review cover all important aspects of the code change?',
        weight: 3,
        scale: {
          1: 'Missed critical issues, superficial review',
          2: 'Covered some issues but missed several important ones',
          3: 'Adequate coverage of main concerns',
          4: 'Comprehensive review covering edge cases and best practices',
          5: 'Exhaustive review including security, performance, and maintainability',
        },
      },
      {
        id: 'actionability',
        name: 'Actionability',
        description: 'Are the suggestions specific and actionable?',
        weight: 2,
        scale: {
          1: 'Vague feedback with no specific recommendations',
          2: 'Some specific suggestions but mostly general advice',
          3: 'Mix of specific and general feedback',
          4: 'Mostly specific, actionable suggestions with code examples',
          5: 'All feedback is specific, actionable, and includes concrete fixes',
        },
      },
      {
        id: 'tone',
        name: 'Tone',
        description: 'Is the review constructive and professional?',
        weight: 1,
        scale: {
          1: 'Harsh, dismissive, or condescending',
          2: 'Blunt without being constructive',
          3: 'Neutral and professional',
          4: 'Constructive with positive reinforcement',
          5: 'Encouraging, educational, and collaborative',
        },
      },
    ],
  },
  {
    id: 'customer-support',
    name: 'Customer Support',
    description:
      'Rubric for support-focused agents — covers accuracy, resolution, empathy, and response awareness.',
    criteria: [
      {
        id: 'accuracy',
        name: 'Accuracy',
        description: 'Is the information provided factually correct?',
        weight: 3,
        scale: {
          1: 'Provides incorrect or misleading information',
          2: 'Mix of correct and incorrect information',
          3: 'Mostly accurate with some gaps',
          4: 'Accurate information with minor omissions',
          5: 'Completely accurate and comprehensive',
        },
      },
      {
        id: 'resolution',
        name: 'Resolution',
        description: "Was the customer's issue resolved or meaningfully advanced?",
        weight: 3,
        scale: {
          1: 'Issue completely unaddressed',
          2: 'Acknowledged but not advanced',
          3: 'Partially addressed, customer needs follow-up',
          4: 'Substantially resolved with clear next steps',
          5: 'Fully resolved with proactive prevention advice',
        },
      },
      {
        id: 'empathy',
        name: 'Empathy',
        description:
          "Does the response acknowledge the customer's frustration and demonstrate understanding?",
        weight: 2,
        scale: {
          1: 'Robotic, ignores customer emotion',
          2: 'Minimal acknowledgment',
          3: 'Standard courtesy phrases',
          4: 'Genuine empathy with personalized response',
          5: 'Exceptional emotional intelligence, makes customer feel heard',
        },
      },
      {
        id: 'response-awareness',
        name: 'Response Time Awareness',
        description: 'Is the response appropriately concise for the urgency level?',
        weight: 1,
        scale: {
          1: 'Overly verbose or terse for the situation',
          2: 'Poor length calibration',
          3: 'Acceptable length',
          4: 'Well-calibrated response length',
          5: 'Perfect balance of thoroughness and brevity',
        },
      },
    ],
  },
  {
    id: 'research-analysis',
    name: 'Research & Analysis',
    description:
      'Rubric for research-focused agents — covers accuracy, depth, source quality, and clarity.',
    criteria: [
      {
        id: 'accuracy',
        name: 'Accuracy',
        description: 'Are the facts and claims correct?',
        weight: 3,
        scale: {
          1: 'Fabricated or fundamentally wrong information',
          2: 'Multiple significant errors',
          3: 'Mostly accurate with some gaps',
          4: 'Accurate with minor imprecisions',
          5: 'Completely accurate with proper caveats',
        },
      },
      {
        id: 'depth',
        name: 'Depth',
        description: 'Does the analysis go beyond surface-level information?',
        weight: 3,
        scale: {
          1: 'Surface-level only, no analysis',
          2: 'Shallow analysis, misses key nuances',
          3: 'Adequate depth covering main points',
          4: 'Deep analysis with nuanced insights',
          5: 'Comprehensive analysis with novel connections and implications',
        },
      },
      {
        id: 'source-quality',
        name: 'Source Quality',
        description: 'Are sources credible and properly referenced?',
        weight: 2,
        scale: {
          1: 'No sources or completely unreliable sources',
          2: 'Questionable sources without verification',
          3: 'Mix of reliable and unreliable sources',
          4: 'Mostly credible sources, properly attributed',
          5: 'High-quality, diverse sources with clear attribution',
        },
      },
      {
        id: 'clarity',
        name: 'Clarity',
        description: 'Is the research presented clearly and logically?',
        weight: 2,
        scale: {
          1: 'Confusing, disorganized presentation',
          2: 'Somewhat disorganized, hard to follow',
          3: 'Adequately organized',
          4: 'Clear and well-structured',
          5: 'Exceptionally clear with logical flow and executive summary',
        },
      },
    ],
  },
]

function requireAgentId(context: { agentId?: string }): string {
  if (!context.agentId) throw new Error('Agent context is required.')
  return context.agentId
}

function toJsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

function encodeCursor(cursor: CursorValue | null): string | null {
  if (!cursor) return null
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64')
}

function decodeCursor(cursor: string | undefined): CursorValue | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as CursorValue
    return typeof parsed.createdAt === 'number' && typeof parsed.id === 'string' ? parsed : null
  } catch {
    return null
  }
}

function parseCriteria(input: unknown): RubricCriterion[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('criteria is required when template_id is not provided.')
  }
  return input as RubricCriterion[]
}

function parseEvaluatorConfig(configJson: string): { rubric_id?: string } {
  try {
    return JSON.parse(configJson) as { rubric_id?: string }
  } catch {
    return {}
  }
}

async function requireEvalGrant(context: { agentId?: string }, action: string) {
  const agentId = requireAgentId(context)
  await assertAgentGrant({ agentId, action, resourceType: '*' })
  return agentId
}

async function buildAgentEvalSummary(agentId: string) {
  const summary = await getAgentEvalSummary(agentId)
  const trend = await getEvalTrendDirection(agentId)

  let recentTrend: 'improving' | 'declining' | 'stable' | 'insufficient_data' = 'insufficient_data'
  if (trend.recentCount >= 3 && trend.previousCount >= 3) {
    const delta = (trend.recentAvg ?? 0) - (trend.previousAvg ?? 0)
    if (delta > 0.02) recentTrend = 'improving'
    else if (delta < -0.02) recentTrend = 'declining'
    else recentTrend = 'stable'
  }

  const assignments = await listAgentEvaluators(agentId)
  const evaluatorBreakdown = await Promise.all(
    assignments.map(async (assignment) => {
      const stats = await getEvaluatorStats(agentId, assignment.evaluator_id)
      const passRate = stats.evalCount > 0 ? stats.passCount / stats.evalCount : null
      const evaluator = await findEvaluatorById(assignment.evaluator_id)
      const rubricId = evaluator ? parseEvaluatorConfig(evaluator.config_json).rubric_id : undefined

      return {
        assignmentId: assignment.id,
        evaluatorId: assignment.evaluator_id,
        evaluatorName: assignment.evaluator_name,
        evaluatorType: assignment.evaluator_type,
        rubricId: rubricId ?? null,
        isGate: assignment.is_gate === 1,
        weight: assignment.weight,
        normalizedWeight: 0,
        avgScore: assignment.is_gate === 0 ? (stats.avgScore ?? null) : null,
        passRate: assignment.is_gate === 1 ? passRate : null,
        evalCount: stats.evalCount,
      }
    })
  )

  const scorerAssignments = evaluatorBreakdown.filter((entry) => !entry.isGate)
  const totalWeight = scorerAssignments.reduce((sum, entry) => sum + entry.weight, 0)
  for (const entry of evaluatorBreakdown) {
    entry.normalizedWeight = !entry.isGate && totalWeight > 0 ? entry.weight / totalWeight : 0
  }

  return { ...summary, recentTrend, evaluatorBreakdown }
}

async function resolveRubricAssignment(agentId: string, rubricId: string) {
  const rubric = await findRubricById(rubricId)
  if (!rubric) throw new Error('Rubric not found.')

  let evaluator = await findEvaluatorByRubricId(rubricId)
  if (!evaluator) {
    evaluator = await createEvaluator({
      name: rubric.name,
      description: rubric.description,
      type: 'llm_judge',
      config_json: JSON.stringify({ rubric_id: rubric.id }),
      judge_model: rubric.judge_model,
    })
  }

  const assignments = await listAgentEvaluators(agentId)
  const existingAssignment = assignments.find(
    (assignment) => assignment.evaluator_id === evaluator.id
  )

  return { rubric, evaluator, existingAssignment }
}

export const evalDefinitions: Anthropic.Tool[] = [
  {
    name: 'get_eval_summary',
    description:
      'Get a compact eval summary. With agent_id, returns that agent summary plus trend and rubric assignment breakdown. Without agent_id, returns the fleet-wide summary.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Optional agent id for an agent-specific summary.',
        },
        include_per_agent_stats: {
          type: 'boolean',
          description: 'Fleet summary only: include per-agent breakdown rows.',
        },
      },
    },
  },
  {
    name: 'list_eval_runs',
    description:
      'List eval runs for an agent or the fleet with compact paging. Returns runs plus next_cursor when more results are available.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string' },
        status: { type: 'string' },
        gates_passed: { type: 'boolean' },
        limit: { type: 'integer', description: 'Maximum results (default: 25, max: 100).' },
        cursor: {
          type: 'string',
          description: 'Opaque cursor from a previous list_eval_runs call.',
        },
      },
    },
  },
  {
    name: 'get_eval_run',
    description: 'Get one eval run and all of its evaluator results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        run_id: { type: 'string' },
      },
      required: ['run_id'],
    },
  },
  {
    name: 'list_rubrics',
    description:
      'List rubrics. With agent_id, only returns rubrics currently assigned to that agent through eval assignments.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string' },
      },
    },
  },
  {
    name: 'get_rubric',
    description: 'Get one rubric and the linked evaluator if one exists.',
    input_schema: {
      type: 'object' as const,
      properties: {
        rubric_id: { type: 'string' },
      },
      required: ['rubric_id'],
    },
  },
  {
    name: 'list_agent_eval_assignments',
    description:
      'List rubric-first eval assignments for one agent, including weight, gate mode, activity, and the linked evaluator.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_eval_settings',
    description: 'Get global eval pipeline settings.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'create_rubric',
    description:
      'Create a rubric and its linked llm_judge evaluator. Provide either template_id or criteria.',
    input_schema: {
      type: 'object' as const,
      properties: {
        template_id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        criteria: { type: 'array', items: { type: 'object' } },
        judge_model: { type: 'string' },
      },
    },
  },
  {
    name: 'update_rubric',
    description: 'Update a rubric and keep its linked evaluator metadata in sync.',
    input_schema: {
      type: 'object' as const,
      properties: {
        rubric_id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        criteria: { type: 'array', items: { type: 'object' } },
        judge_model: { type: 'string' },
        clear_judge_model: { type: 'boolean' },
      },
      required: ['rubric_id'],
    },
  },
  {
    name: 'delete_rubric',
    description: 'Delete a rubric and its linked evaluator.',
    input_schema: {
      type: 'object' as const,
      properties: {
        rubric_id: { type: 'string' },
      },
      required: ['rubric_id'],
    },
  },
  {
    name: 'update_agent_eval_assignment',
    description:
      'Create or update a rubric assignment for an agent. Use enabled=false to disable an existing assignment without deleting the rubric.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string' },
        rubric_id: { type: 'string' },
        enabled: { type: 'boolean' },
        weight: { type: 'number' },
        is_gate: { type: 'boolean' },
        sample_rate: { type: 'number' },
        clear_sample_rate: { type: 'boolean' },
      },
      required: ['agent_id', 'rubric_id'],
    },
  },
  {
    name: 'run_eval_for_job',
    description: 'Enqueue a manual eval run for a completed job.',
    input_schema: {
      type: 'object' as const,
      properties: {
        job_id: { type: 'string' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'update_eval_settings',
    description: 'Update global eval pipeline settings.',
    input_schema: {
      type: 'object' as const,
      properties: {
        judge_model: { type: 'string' },
        clear_judge_model: { type: 'boolean' },
        max_daily_evals: { type: 'integer' },
        sample_rate_default: { type: 'number' },
        sample_rate_high_volume_threshold: { type: 'integer' },
        sample_rate_high_volume: { type: 'number' },
        eval_cost_budget_usd: { type: 'number' },
        clear_eval_cost_budget_usd: { type: 'boolean' },
      },
    },
  },
]

export const getEvalSummaryTool: ToolHandler = async (input, context) => {
  try {
    await requireEvalGrant(context, 'eval.read')
    const agentId = typeof input.agent_id === 'string' ? input.agent_id : undefined

    if (agentId) {
      const agent = await findAgentById(agentId)
      if (!agent) return { success: false, error: 'Agent not found.' }
      return { success: true, output: toJsonOutput(await buildAgentEvalSummary(agentId)) }
    }

    const summary = await getFleetEvalSummary()
    const includePerAgentStats = input.include_per_agent_stats === true
    return {
      success: true,
      output: toJsonOutput({
        ...summary,
        perAgentStats: includePerAgentStats ? await getPerAgentEvalStats() : undefined,
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const listEvalRunsTool: ToolHandler = async (input, context) => {
  try {
    await requireEvalGrant(context, 'eval.read')
    const limit = Math.min(Math.max(typeof input.limit === 'number' ? input.limit : 25, 1), 100)
    const cursor = typeof input.cursor === 'string' ? decodeCursor(input.cursor) : null
    if (typeof input.cursor === 'string' && !cursor) {
      return { success: false, error: 'Invalid cursor.' }
    }

    const agentId = typeof input.agent_id === 'string' ? input.agent_id : undefined
    const status = typeof input.status === 'string' ? input.status : undefined
    const gatesPassed = typeof input.gates_passed === 'boolean' ? input.gates_passed : undefined

    if (agentId) {
      const runs = await listEvalRunsByAgent(agentId, {
        status,
        gatesPassed,
        limit: limit + 1,
        cursor: cursor ?? undefined,
      })
      const hasMore = runs.length > limit
      const trimmed = hasMore ? runs.slice(0, limit) : runs
      const nextCursor =
        hasMore && trimmed.length > 0
          ? encodeCursor({
              createdAt: trimmed[trimmed.length - 1]!.created_at,
              id: trimmed[trimmed.length - 1]!.id,
            })
          : null
      return { success: true, output: toJsonOutput({ runs: trimmed, nextCursor }) }
    }

    const runs = await listRecentEvalRuns({
      status,
      gatesPassed,
      limit: limit + 1,
      cursor: cursor ?? undefined,
    })
    const hasMore = runs.length > limit
    const trimmed = hasMore ? runs.slice(0, limit) : runs
    const nextCursor =
      hasMore && trimmed.length > 0
        ? encodeCursor({
            createdAt: trimmed[trimmed.length - 1]!.created_at,
            id: trimmed[trimmed.length - 1]!.id,
          })
        : null
    return { success: true, output: toJsonOutput({ runs: trimmed, nextCursor }) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const getEvalRunTool: ToolHandler = async (input, context) => {
  try {
    await requireEvalGrant(context, 'eval.read')
    const runId = typeof input.run_id === 'string' ? input.run_id.trim() : ''
    if (!runId) return { success: false, error: 'run_id is required.' }

    const run = await findEvalRunById(runId)
    if (!run) return { success: false, error: 'Eval run not found.' }
    const results = await listEvalResultsByRun(run.id)
    return { success: true, output: toJsonOutput({ ...run, results }) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const listRubricsTool: ToolHandler = async (input, context) => {
  try {
    await requireEvalGrant(context, 'eval.read')
    const rubrics = await listRubrics()
    const agentId = typeof input.agent_id === 'string' ? input.agent_id : undefined
    if (!agentId) return { success: true, output: toJsonOutput({ rubrics }) }

    const assignments = await listAgentEvaluators(agentId)
    const assignedEvaluatorIds = new Set(assignments.map((assignment) => assignment.evaluator_id))
    const filtered: typeof rubrics = []
    for (const rubric of rubrics) {
      const evaluator = await findEvaluatorByRubricId(rubric.id)
      if (evaluator && assignedEvaluatorIds.has(evaluator.id)) filtered.push(rubric)
    }
    return { success: true, output: toJsonOutput({ rubrics: filtered }) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const getRubricTool: ToolHandler = async (input, context) => {
  try {
    await requireEvalGrant(context, 'eval.read')
    const rubricId = typeof input.rubric_id === 'string' ? input.rubric_id.trim() : ''
    if (!rubricId) return { success: false, error: 'rubric_id is required.' }

    const rubric = await findRubricById(rubricId)
    if (!rubric) return { success: false, error: 'Rubric not found.' }
    const evaluator = await findEvaluatorByRubricId(rubricId)
    return { success: true, output: toJsonOutput({ ...rubric, evaluator }) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const listAgentEvalAssignmentsTool: ToolHandler = async (input, context) => {
  try {
    await requireEvalGrant(context, 'eval.read')
    const agentId = typeof input.agent_id === 'string' ? input.agent_id.trim() : ''
    if (!agentId) return { success: false, error: 'agent_id is required.' }

    const assignments = await listAgentEvaluators(agentId)
    const enriched = await Promise.all(
      assignments.map(async (assignment) => {
        const evaluator = await findEvaluatorById(assignment.evaluator_id)
        const rubricId = evaluator
          ? parseEvaluatorConfig(evaluator.config_json).rubric_id
          : undefined
        const rubric = rubricId ? await findRubricById(rubricId) : null

        return {
          assignmentId: assignment.id,
          agentId: assignment.agent_id,
          evaluatorId: assignment.evaluator_id,
          evaluatorName: assignment.evaluator_name,
          evaluatorType: assignment.evaluator_type,
          rubricId: rubric?.id ?? rubricId ?? null,
          rubricName: rubric?.name ?? null,
          rubricVersion: rubric?.version ?? null,
          weight: assignment.weight,
          isActive: assignment.is_active === 1,
          isGate: assignment.is_gate === 1,
          sampleRate: assignment.sample_rate,
          createdAt: assignment.created_at,
          updatedAt: assignment.updated_at,
        }
      })
    )

    return { success: true, output: toJsonOutput({ assignments: enriched }) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const getEvalSettingsTool: ToolHandler = async (_input, context) => {
  try {
    await requireEvalGrant(context, 'eval.read')
    return { success: true, output: toJsonOutput(await getEvalSettings()) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const createRubricTool: ToolHandler = async (input, context) => {
  try {
    await requireEvalGrant(context, 'eval.write')

    const templateId = typeof input.template_id === 'string' ? input.template_id.trim() : ''
    const template = templateId ? RUBRIC_TEMPLATES.find((entry) => entry.id === templateId) : null
    if (templateId && !template) return { success: false, error: 'Template not found.' }

    const name =
      typeof input.name === 'string' && input.name.trim() ? input.name.trim() : template?.name
    if (!name) return { success: false, error: 'name is required.' }

    const description =
      typeof input.description === 'string' ? input.description : (template?.description ?? null)
    const criteria = template ? template.criteria : parseCriteria(input.criteria)
    const judgeModel = typeof input.judge_model === 'string' ? input.judge_model : null

    const rubric = await createRubric({
      name,
      description,
      criteria_json: JSON.stringify(criteria),
      judge_model: judgeModel,
      created_by: 'agent',
    })
    const evaluator = await createEvaluator({
      name,
      description,
      type: 'llm_judge',
      config_json: JSON.stringify({ rubric_id: rubric.id }),
      judge_model: judgeModel,
    })

    return { success: true, output: toJsonOutput({ rubric, evaluator }) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const updateRubricTool: ToolHandler = async (input, context) => {
  try {
    await requireEvalGrant(context, 'eval.write')
    const rubricId = typeof input.rubric_id === 'string' ? input.rubric_id.trim() : ''
    if (!rubricId) return { success: false, error: 'rubric_id is required.' }

    const updated = await updateRubric(rubricId, {
      name: typeof input.name === 'string' ? input.name : undefined,
      description: typeof input.description === 'string' ? input.description : undefined,
      criteria_json: Array.isArray(input.criteria) ? JSON.stringify(input.criteria) : undefined,
      judge_model:
        input.clear_judge_model === true
          ? null
          : typeof input.judge_model === 'string'
            ? input.judge_model
            : undefined,
    })
    if (!updated) return { success: false, error: 'Rubric not found.' }

    const evaluator = await findEvaluatorByRubricId(rubricId)
    if (evaluator) {
      await updateEvaluator(evaluator.id, {
        name: typeof input.name === 'string' ? input.name : undefined,
        description: typeof input.description === 'string' ? input.description : undefined,
        judge_model:
          input.clear_judge_model === true
            ? null
            : typeof input.judge_model === 'string'
              ? input.judge_model
              : undefined,
      })
    }

    return { success: true, output: toJsonOutput(updated) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const deleteRubricTool: ToolHandler = async (input, context) => {
  try {
    await requireEvalGrant(context, 'eval.write')
    const rubricId = typeof input.rubric_id === 'string' ? input.rubric_id.trim() : ''
    if (!rubricId) return { success: false, error: 'rubric_id is required.' }

    const evaluator = await findEvaluatorByRubricId(rubricId)
    if (evaluator) await deleteEvaluator(evaluator.id)
    const deleted = await deleteRubric(rubricId)
    if (!deleted) return { success: false, error: 'Rubric not found.' }
    return { success: true, output: toJsonOutput({ deleted: true, rubricId }) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const updateAgentEvalAssignmentTool: ToolHandler = async (input, context) => {
  try {
    await requireEvalGrant(context, 'eval.write')
    const agentId = typeof input.agent_id === 'string' ? input.agent_id.trim() : ''
    const rubricId = typeof input.rubric_id === 'string' ? input.rubric_id.trim() : ''
    if (!agentId) return { success: false, error: 'agent_id is required.' }
    if (!rubricId) return { success: false, error: 'rubric_id is required.' }

    const agent = await findAgentById(agentId)
    if (!agent) return { success: false, error: 'Agent not found.' }

    const { rubric, evaluator, existingAssignment } = await resolveRubricAssignment(
      agentId,
      rubricId
    )
    const enabled = typeof input.enabled === 'boolean' ? input.enabled : true
    const sampleRate =
      input.clear_sample_rate === true
        ? null
        : typeof input.sample_rate === 'number'
          ? input.sample_rate
          : undefined

    if (existingAssignment) {
      if (enabled === false && existingAssignment.is_active === 1) {
        const updated = await updateAgentEvaluator(existingAssignment.id, { is_active: 0 })
        return {
          success: true,
          output: toJsonOutput({
            action: 'disabled',
            rubricId: rubric.id,
            evaluatorId: evaluator.id,
            assignment: updated,
          }),
        }
      }

      const updated = await updateAgentEvaluator(existingAssignment.id, {
        weight: typeof input.weight === 'number' ? input.weight : undefined,
        is_active: typeof input.enabled === 'boolean' ? (input.enabled ? 1 : 0) : undefined,
        is_gate: typeof input.is_gate === 'boolean' ? (input.is_gate ? 1 : 0) : undefined,
        sample_rate: sampleRate,
      })
      return {
        success: true,
        output: toJsonOutput({
          action: 'updated',
          rubricId: rubric.id,
          evaluatorId: evaluator.id,
          assignment: updated,
        }),
      }
    }

    if (enabled === false) {
      return {
        success: true,
        output: toJsonOutput({
          action: 'noop',
          rubricId: rubric.id,
          evaluatorId: evaluator.id,
          reason: 'Assignment was already absent.',
        }),
      }
    }

    const created = await assignEvaluatorToAgent({
      agent_id: agentId,
      evaluator_id: evaluator.id,
      weight: typeof input.weight === 'number' ? input.weight : undefined,
      is_active: 1,
      is_gate: typeof input.is_gate === 'boolean' ? (input.is_gate ? 1 : 0) : 0,
      sample_rate: typeof sampleRate === 'number' || sampleRate === null ? sampleRate : null,
    })

    return {
      success: true,
      output: toJsonOutput({
        action: 'created',
        rubricId: rubric.id,
        evaluatorId: evaluator.id,
        assignment: created,
      }),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.toLowerCase().includes('unique')) {
      return { success: false, error: 'This rubric is already assigned to the agent.' }
    }
    return { success: false, error: message }
  }
}

export const runEvalForJobTool: ToolHandler = async (input, context) => {
  try {
    await requireEvalGrant(context, 'eval.run.execute')
    const jobId = typeof input.job_id === 'string' ? input.job_id.trim() : ''
    if (!jobId) return { success: false, error: 'job_id is required.' }

    const job = await findJobById(jobId)
    if (!job) return { success: false, error: 'Job not found.' }
    if (String(job.status).toUpperCase() !== 'COMPLETED') {
      return { success: false, error: 'Only completed jobs can be evaluated manually.' }
    }
    if (!job.agent_id || !job.work_item_id) {
      return { success: false, error: 'Job is missing agent or work item context.' }
    }

    const evalRun = await createEvalRun({
      job_id: jobId,
      agent_id: job.agent_id,
      work_item_id: job.work_item_id,
      trigger: 'manual',
      status: 'pending',
    })
    return { success: true, output: toJsonOutput(evalRun) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const updateEvalSettingsTool: ToolHandler = async (input, context) => {
  try {
    await requireEvalGrant(context, 'eval.settings.write')
    const updates: Record<string, unknown> = {}
    if (typeof input.judge_model === 'string') updates.judge_model = input.judge_model
    if (input.clear_judge_model === true) updates.judge_model = null
    if (typeof input.max_daily_evals === 'number') updates.max_daily_evals = input.max_daily_evals
    if (typeof input.sample_rate_default === 'number')
      updates.sample_rate_default = input.sample_rate_default
    if (typeof input.sample_rate_high_volume_threshold === 'number') {
      updates.sample_rate_high_volume_threshold = input.sample_rate_high_volume_threshold
    }
    if (typeof input.sample_rate_high_volume === 'number') {
      updates.sample_rate_high_volume = input.sample_rate_high_volume
    }
    if (typeof input.eval_cost_budget_usd === 'number') {
      updates.eval_cost_budget_usd = input.eval_cost_budget_usd
    }
    if (input.clear_eval_cost_budget_usd === true) {
      updates.eval_cost_budget_usd = null
    }

    return { success: true, output: toJsonOutput(await updateEvalSettings(updates)) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
