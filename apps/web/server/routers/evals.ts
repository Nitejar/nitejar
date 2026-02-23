import { TRPCError } from '@trpc/server'
import {
  createRubric,
  findRubricById,
  listRubrics,
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
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

// ============================================================================
// Zod schemas
// ============================================================================

const evaluatorTypeSchema = z.enum([
  'llm_judge',
  'programmatic',
  'statistical',
  'safety',
  'human_feedback',
  'task_completion',
  'custom',
])

const rubricCriterionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  weight: z.number().min(0),
  scale: z.object({
    1: z.string().min(1),
    2: z.string().min(1),
    3: z.string().min(1),
    4: z.string().min(1),
    5: z.string().min(1),
  }),
})

// ============================================================================
// Rubric templates (static, not in DB)
// ============================================================================

const RUBRIC_TEMPLATES = [
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

// ============================================================================
// Router
// ============================================================================

export const evalsRouter = router({
  // --------------------------------------------------------------------------
  // Evaluator CRUD
  // --------------------------------------------------------------------------

  listEvaluators: protectedProcedure
    .input(
      z
        .object({
          type: evaluatorTypeSchema.optional(),
          agentId: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const evaluators = await listEvaluators({ type: input?.type })
      if (!input?.agentId) return evaluators

      // Filter to evaluators assigned to the agent
      const assignments = await listAgentEvaluators(input.agentId)
      const assignedIds = new Set(assignments.map((a) => a.evaluator_id))
      return evaluators.filter((e) => assignedIds.has(e.id))
    }),

  getEvaluator: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const evaluator = await findEvaluatorById(input.id)
    if (!evaluator) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Evaluator not found' })
    }
    return evaluator
  }),

  createEvaluator: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        type: evaluatorTypeSchema,
        configJson: z.record(z.unknown()),
        judgeModel: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return createEvaluator({
        name: input.name,
        description: input.description ?? null,
        type: input.type,
        config_json: JSON.stringify(input.configJson),
        judge_model: input.judgeModel ?? null,
      })
    }),

  updateEvaluator: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        configJson: z.record(z.unknown()).optional(),
        judgeModel: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const updated = await updateEvaluator(input.id, {
        name: input.name,
        description: input.description,
        config_json: input.configJson ? JSON.stringify(input.configJson) : undefined,
        judge_model: input.judgeModel,
      })
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Evaluator not found' })
      }
      return updated
    }),

  deleteEvaluator: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const deleted = await deleteEvaluator(input.id)
      if (!deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Evaluator not found' })
      }
      return { success: true }
    }),

  assignEvaluatorToAgent: protectedProcedure
    .input(
      z.object({
        agentId: z.string(),
        evaluatorId: z.string(),
        weight: z.number().min(0).optional(),
        isActive: z.boolean().optional(),
        isGate: z.boolean().optional(),
        sampleRate: z.number().min(0).max(1).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const agent = await findAgentById(input.agentId)
      if (!agent) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })

      const evaluator = await findEvaluatorById(input.evaluatorId)
      if (!evaluator) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evaluator not found' })

      try {
        return await assignEvaluatorToAgent({
          agent_id: input.agentId,
          evaluator_id: input.evaluatorId,
          weight: input.weight,
          is_active: input.isActive === false ? 0 : 1,
          is_gate: input.isGate ? 1 : 0,
          sample_rate: input.sampleRate ?? null,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.toLowerCase().includes('unique')) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Evaluator is already assigned to this agent.',
          })
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message })
      }
    }),

  updateAgentEvaluator: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        weight: z.number().min(0).optional(),
        isActive: z.boolean().optional(),
        isGate: z.boolean().optional(),
        sampleRate: z.number().min(0).max(1).nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const updated = await updateAgentEvaluator(input.id, {
        weight: input.weight,
        is_active: input.isActive !== undefined ? (input.isActive ? 1 : 0) : undefined,
        is_gate: input.isGate !== undefined ? (input.isGate ? 1 : 0) : undefined,
        sample_rate: input.sampleRate,
      })
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent evaluator assignment not found' })
      }
      return updated
    }),

  removeEvaluatorFromAgent: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const deleted = await removeEvaluatorFromAgent(input.id)
      if (!deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent evaluator assignment not found' })
      }
      return { success: true }
    }),

  listAgentEvaluators: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input }) => {
      return listAgentEvaluators(input.agentId)
    }),

  // --------------------------------------------------------------------------
  // Rubric CRUD (convenience wrappers)
  // --------------------------------------------------------------------------

  listRubrics: protectedProcedure
    .input(z.object({ agentId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const rubrics = await listRubrics()
      if (!input?.agentId) return rubrics

      // Filter to rubrics assigned to the agent via evaluators
      const assignments = await listAgentEvaluators(input.agentId)
      const assignedEvaluatorIds = new Set(assignments.map((a) => a.evaluator_id))

      // For each rubric, check if there is an evaluator that references it
      const filteredRubrics = []
      for (const rubric of rubrics) {
        const evaluator = await findEvaluatorByRubricId(rubric.id)
        if (evaluator && assignedEvaluatorIds.has(evaluator.id)) {
          filteredRubrics.push(rubric)
        }
      }
      return filteredRubrics
    }),

  getRubric: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const rubric = await findRubricById(input.id)
    if (!rubric) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Rubric not found' })
    }
    return rubric
  }),

  createRubric: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        criteriaJson: z.array(rubricCriterionSchema),
        judgeModel: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const rubric = await createRubric({
        name: input.name,
        description: input.description ?? null,
        criteria_json: JSON.stringify(input.criteriaJson),
        judge_model: input.judgeModel ?? null,
        created_by: 'admin',
      })

      // Also create an evaluator of type llm_judge referencing this rubric
      const evaluator = await createEvaluator({
        name: input.name,
        description: input.description ?? null,
        type: 'llm_judge',
        config_json: JSON.stringify({ rubric_id: rubric.id }),
        judge_model: input.judgeModel ?? null,
      })

      return { rubric, evaluator }
    }),

  updateRubric: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        criteriaJson: z.array(rubricCriterionSchema).optional(),
        judgeModel: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const updated = await updateRubric(input.id, {
        name: input.name,
        description: input.description,
        criteria_json: input.criteriaJson ? JSON.stringify(input.criteriaJson) : undefined,
        judge_model: input.judgeModel,
      })
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Rubric not found' })
      }

      // Also update the associated evaluator if name/description/judgeModel changed
      const evaluator = await findEvaluatorByRubricId(input.id)
      if (evaluator) {
        await updateEvaluator(evaluator.id, {
          name: input.name,
          description: input.description,
          judge_model: input.judgeModel,
        })
      }

      return updated
    }),

  deleteRubric: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      // Also delete the associated evaluator (which cascades to agent_evaluators)
      const evaluator = await findEvaluatorByRubricId(input.id)
      if (evaluator) {
        await deleteEvaluator(evaluator.id)
      }

      const deleted = await deleteRubric(input.id)
      if (!deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Rubric not found' })
      }
      return { success: true }
    }),

  assignRubricToAgent: protectedProcedure
    .input(
      z.object({
        agentId: z.string(),
        rubricId: z.string(),
        weight: z.number().min(0).optional(),
        isActive: z.boolean().optional(),
        sampleRate: z.number().min(0).max(1).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const agent = await findAgentById(input.agentId)
      if (!agent) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })

      const rubric = await findRubricById(input.rubricId)
      if (!rubric) throw new TRPCError({ code: 'NOT_FOUND', message: 'Rubric not found' })

      // Find or create the evaluator for this rubric
      let evaluator = await findEvaluatorByRubricId(input.rubricId)
      if (!evaluator) {
        evaluator = await createEvaluator({
          name: rubric.name,
          description: rubric.description,
          type: 'llm_judge',
          config_json: JSON.stringify({ rubric_id: rubric.id }),
          judge_model: rubric.judge_model,
        })
      }

      return assignEvaluatorToAgent({
        agent_id: input.agentId,
        evaluator_id: evaluator.id,
        weight: input.weight,
        is_active: input.isActive === false ? 0 : 1,
        is_gate: 0,
        sample_rate: input.sampleRate ?? null,
      })
    }),

  listTemplates: protectedProcedure.query(() => {
    return RUBRIC_TEMPLATES
  }),

  createFromTemplate: protectedProcedure
    .input(
      z.object({
        templateId: z.string(),
        agentId: z.string().optional(),
        weight: z.number().min(0).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const template = RUBRIC_TEMPLATES.find((t) => t.id === input.templateId)
      if (!template) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' })
      }

      const rubric = await createRubric({
        name: template.name,
        description: template.description,
        criteria_json: JSON.stringify(template.criteria),
        judge_model: null,
        created_by: 'admin',
      })

      const evaluator = await createEvaluator({
        name: template.name,
        description: template.description,
        type: 'llm_judge',
        config_json: JSON.stringify({ rubric_id: rubric.id }),
        judge_model: null,
      })

      if (input.agentId) {
        const agent = await findAgentById(input.agentId)
        if (!agent) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })

        await assignEvaluatorToAgent({
          agent_id: input.agentId,
          evaluator_id: evaluator.id,
          weight: input.weight,
          is_active: 1,
          is_gate: 0,
          sample_rate: null,
        })
      }

      return { rubric, evaluator }
    }),

  // --------------------------------------------------------------------------
  // Eval run operations
  // --------------------------------------------------------------------------

  getEvalRun: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const evalRun = await findEvalRunById(input.id)
    if (!evalRun) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Eval run not found' })
    }

    const results = await listEvalResultsByRun(evalRun.id)
    return { ...evalRun, results }
  }),

  listEvalRuns: protectedProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        evaluatorId: z.string().optional(),
        status: z.string().optional(),
        gatesPassed: z.boolean().optional(),
        limit: z.number().min(1).max(100).optional(),
        cursor: z
          .object({
            createdAt: z.number(),
            id: z.string(),
          })
          .optional(),
      })
    )
    .query(async ({ input }) => {
      const limit = input.limit ?? 50

      if (input.agentId) {
        // Agent-specific: use existing function
        const runs = await listEvalRunsByAgent(input.agentId, {
          status: input.status,
          gatesPassed: input.gatesPassed,
          evaluatorId: input.evaluatorId,
          limit: limit + 1,
          cursor: input.cursor,
        })

        const hasMore = runs.length > limit
        const trimmed = hasMore ? runs.slice(0, limit) : runs
        const nextCursor =
          hasMore && trimmed.length > 0
            ? {
                createdAt: trimmed[trimmed.length - 1]!.created_at,
                id: trimmed[trimmed.length - 1]!.id,
              }
            : null

        return {
          runs: trimmed.map((r) => ({ ...r, agent_name: undefined as string | undefined })),
          nextCursor,
        }
      }

      // Fleet-wide: use new function that includes agent_name
      const runs = await listRecentEvalRuns({
        status: input.status,
        gatesPassed: input.gatesPassed,
        limit: limit + 1,
        cursor: input.cursor,
      })

      const hasMore = runs.length > limit
      const trimmed = hasMore ? runs.slice(0, limit) : runs
      const nextCursor =
        hasMore && trimmed.length > 0
          ? {
              createdAt: trimmed[trimmed.length - 1]!.created_at,
              id: trimmed[trimmed.length - 1]!.id,
            }
          : null

      return { runs: trimmed, nextCursor }
    }),

  getEvalsForJob: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const runs = await listEvalRunsByJob(input.jobId)
      const results = await Promise.all(
        runs.map(async (run) => {
          const evalResults = await listEvalResultsByRun(run.id)
          return { ...run, results: evalResults }
        })
      )
      return results
    }),

  // --------------------------------------------------------------------------
  // Trend and aggregation queries
  // --------------------------------------------------------------------------

  getScoreTrend: protectedProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        evaluatorId: z.string().optional(),
        evaluatorType: z.string().optional(),
        days: z.number().min(1).max(365).optional(),
        granularity: z.enum(['day', 'week']).optional(),
      })
    )
    .query(async ({ input }) => {
      if (input.agentId) {
        return getScoreTrend(input.agentId, {
          days: input.days,
          evaluatorId: input.evaluatorId,
          evaluatorType: input.evaluatorType,
          granularity: input.granularity,
        })
      }
      return getFleetScoreTrend({ days: input.days })
    }),

  getAgentEvalSummary: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input }) => {
      const summary = await getAgentEvalSummary(input.agentId)

      // Compute trend direction
      const trend = await getEvalTrendDirection(input.agentId)
      let recentTrend: 'improving' | 'declining' | 'stable' | 'insufficient_data' =
        'insufficient_data'
      if (trend.recentCount >= 3 && trend.previousCount >= 3) {
        const delta = (trend.recentAvg ?? 0) - (trend.previousAvg ?? 0)
        if (delta > 0.02) recentTrend = 'improving'
        else if (delta < -0.02) recentTrend = 'declining'
        else recentTrend = 'stable'
      }

      // Get per-evaluator breakdown
      const assignments = await listAgentEvaluators(input.agentId)
      const evaluatorBreakdown = await Promise.all(
        assignments.map(async (assignment) => {
          const stats = await getEvaluatorStats(input.agentId, assignment.evaluator_id)
          const passRate = stats.evalCount > 0 ? stats.passCount / stats.evalCount : null

          return {
            evaluatorId: assignment.evaluator_id,
            evaluatorName: assignment.evaluator_name,
            evaluatorType: assignment.evaluator_type,
            isGate: assignment.is_gate === 1,
            weight: assignment.weight,
            normalizedWeight: 0, // Will compute below
            avgScore: assignment.is_gate === 0 ? (stats.avgScore ?? null) : null,
            passRate: assignment.is_gate === 1 ? passRate : null,
            evalCount: stats.evalCount,
          }
        })
      )

      // Compute normalized weights for scorers
      const scorerAssignments = evaluatorBreakdown.filter((e) => !e.isGate)
      const totalWeight = scorerAssignments.reduce((sum, e) => sum + e.weight, 0)
      for (const e of evaluatorBreakdown) {
        e.normalizedWeight = !e.isGate && totalWeight > 0 ? e.weight / totalWeight : 0
      }

      const scorersWithScores = evaluatorBreakdown.filter((e) => !e.isGate && e.avgScore !== null)
      const lowestEvaluator =
        scorersWithScores.length > 0
          ? scorersWithScores.reduce((min, e) =>
              (e.avgScore ?? 1) < (min.avgScore ?? 1) ? e : min
            )
          : null
      const highestEvaluator =
        scorersWithScores.length > 0
          ? scorersWithScores.reduce((max, e) =>
              (e.avgScore ?? 0) > (max.avgScore ?? 0) ? e : max
            )
          : null

      return {
        ...summary,
        recentTrend,
        evaluatorBreakdown,
        lowestEvaluator: lowestEvaluator
          ? { name: lowestEvaluator.evaluatorName, avgScore: lowestEvaluator.avgScore! }
          : null,
        highestEvaluator: highestEvaluator
          ? { name: highestEvaluator.evaluatorName, avgScore: highestEvaluator.avgScore! }
          : null,
      }
    }),

  // --------------------------------------------------------------------------
  // Fleet-wide aggregation
  // --------------------------------------------------------------------------

  getFleetEvalSummary: protectedProcedure.query(async () => {
    return getFleetEvalSummary()
  }),

  getFleetPerAgentStats: protectedProcedure.query(async () => {
    return getPerAgentEvalStats()
  }),

  // --------------------------------------------------------------------------
  // Eval settings
  // --------------------------------------------------------------------------

  getSettings: protectedProcedure.query(async () => {
    return getEvalSettings()
  }),

  updateSettings: protectedProcedure
    .input(
      z.object({
        judgeModel: z.string().nullable().optional(),
        maxDailyEvals: z.number().int().min(0).optional(),
        sampleRateDefault: z.number().min(0).max(1).optional(),
        sampleRateHighVolumeThreshold: z.number().int().min(0).optional(),
        sampleRateHighVolume: z.number().min(0).max(1).optional(),
        evalCostBudgetUsd: z.number().min(0).nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const updates: Record<string, unknown> = {}
      if (input.judgeModel !== undefined) updates.judge_model = input.judgeModel
      if (input.maxDailyEvals !== undefined) updates.max_daily_evals = input.maxDailyEvals
      if (input.sampleRateDefault !== undefined)
        updates.sample_rate_default = input.sampleRateDefault
      if (input.sampleRateHighVolumeThreshold !== undefined)
        updates.sample_rate_high_volume_threshold = input.sampleRateHighVolumeThreshold
      if (input.sampleRateHighVolume !== undefined)
        updates.sample_rate_high_volume = input.sampleRateHighVolume
      if (input.evalCostBudgetUsd !== undefined)
        updates.eval_cost_budget_usd = input.evalCostBudgetUsd

      return updateEvalSettings(updates)
    }),
})

export type EvalsRouter = typeof evalsRouter
