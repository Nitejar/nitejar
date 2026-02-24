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
  insertInferenceCall,
} from '@nitejar/database'
import { logSchemaMismatchOnce } from './schema-mismatch'
import { parseAgentConfig } from '@nitejar/agent/config'

const WORKER_STATE_KEY = '__nitejarEvalWorker'
const TICK_MS = 5000 // Check every 5 seconds (evals are not time-critical)
const LEASE_SECONDS = 300 // 5 minutes for eval processing

type WorkerState = {
  started: boolean
  running: boolean
  draining: boolean
  timer?: NodeJS.Timeout
  processFn?: () => Promise<void>
}

function getState(): WorkerState {
  const globalState = globalThis as typeof globalThis & {
    [WORKER_STATE_KEY]?: WorkerState
  }

  const existing = globalState[WORKER_STATE_KEY]
  if (existing) return existing

  const created: WorkerState = {
    started: false,
    running: false,
    draining: false,
  }
  globalState[WORKER_STATE_KEY] = created
  return created
}

// ============================================================================
// Judge model resolution
// ============================================================================

function resolveJudgeModel(
  agentModel: string,
  evaluatorJudgeModel: string | null,
  rubricJudgeModel: string | null,
  systemDefault: string | null
): string {
  if (evaluatorJudgeModel) return evaluatorJudgeModel
  if (rubricJudgeModel) return rubricJudgeModel
  if (systemDefault) return systemDefault
  // Fallback: pick a different model family
  if (agentModel.includes('openai') || agentModel.includes('gpt')) {
    return 'anthropic/claude-3.5-haiku'
  }
  return 'openai/gpt-4o-mini'
}

// ============================================================================
// Context assembly
// ============================================================================

interface EvalContext {
  jobId: string
  agentId: string
  agentName: string
  agentModel: string
  agentSoul: string | null
  workItemTitle: string
  workItemSource: string
  workItemSourceRef: string
  transcript: string
  inferenceTokens: number
  inferenceCost: number
  inferenceCallCount: number
  duration: number | null
}

async function assembleEvalContext(
  jobId: string,
  agentId: string,
  workItemId: string
): Promise<EvalContext | null> {
  const [job, workItem, agent] = await Promise.all([
    findJobById(jobId),
    findWorkItemById(workItemId),
    findAgentById(agentId),
  ])

  if (!job || !workItem || !agent) return null

  const agentConfig = parseAgentConfig(agent.config)
  const messages = await listMessagesByJob(jobId)
  const inferenceCalls = await listInferenceCallsByJob(jobId)

  // Format transcript for the judge
  const transcript = messages
    .map((m) => {
      const role = m.role === 'assistant' ? 'Assistant' : m.role === 'user' ? 'User' : m.role
      let content = m.content ?? ''
      // Truncate very long messages
      if (content.length > 2000) {
        content = content.slice(0, 2000) + '... [truncated]'
      }
      return `[${role}] ${content}`
    })
    .join('\n\n')

  // Aggregate inference stats
  let totalTokens = 0
  let totalCost = 0
  for (const call of inferenceCalls) {
    totalTokens += call.total_tokens
    totalCost += call.cost_usd ?? 0
  }

  const duration =
    job.completed_at && job.started_at ? (job.completed_at - job.started_at) * 1000 : null

  return {
    jobId,
    agentId,
    agentName: agent.name,
    agentModel: agentConfig.model ?? 'unknown',
    agentSoul: agentConfig.soul ?? null,
    workItemTitle: workItem.title,
    workItemSource: workItem.source,
    workItemSourceRef: workItem.source_ref,
    transcript,
    inferenceTokens: totalTokens,
    inferenceCost: totalCost,
    inferenceCallCount: inferenceCalls.length,
    duration,
  }
}

// ============================================================================
// LLM Judge execution
// ============================================================================

interface RubricCriterion {
  id: string
  name: string
  description: string
  weight: number
  scale: {
    1: string
    2: string
    3: string
    4: string
    5: string
  }
}

interface CriterionScore {
  criterion_id: string
  criterion_name: string
  score: number
  reasoning: string
}

interface LlmJudgeResult {
  criteriaScores: CriterionScore[]
  judgeReasoning: string
  judgeModel: string
  normalizedScore: number
  rawScore: number
  costUsd: number
  inputTokenCount: number
  outputTokenCount: number
  durationMs: number
}

function buildJudgePrompt(context: EvalContext, criteria: RubricCriterion[]): string {
  const criteriaText = criteria
    .map((c) => {
      const scaleDesc = Object.entries(c.scale)
        .map(([level, desc]) => `  ${level}: ${desc}`)
        .join('\n')
      return `### ${c.name} (weight: ${c.weight})\n${c.description}\n\nScale:\n${scaleDesc}`
    })
    .join('\n\n')

  const criteriaIds = criteria.map((c) => `"${c.id}"`).join(', ')

  return `You are an independent quality evaluator. Score the following agent interaction using the provided rubric. Be objective and calibrated.

## Agent Information
- Agent: ${context.agentName}
- Model: ${context.agentModel}
- Token count: ${context.inferenceTokens}
- Inference calls: ${context.inferenceCallCount}
${context.duration ? `- Duration: ${Math.round(context.duration / 1000)}s` : ''}

## Work Item
- Title: ${context.workItemTitle}
- Source: ${context.workItemSource}
- Reference: ${context.workItemSourceRef}

## Rubric Criteria

${criteriaText}

## Conversation Transcript

${context.transcript}

## Instructions

Score each criterion independently on the 1-5 scale using the provided descriptors. Provide specific reasoning for each score citing evidence from the transcript. Do not penalize the agent for limitations outside its control (tool unavailability, user ambiguity). Consider the agent's configured personality when evaluating tone.

Return a JSON object with the following structure:
{
  "criteria_scores": [
    { "criterion_id": "<id>", "criterion_name": "<name>", "score": <1-5>, "reasoning": "<specific evidence>" }
  ],
  "overall_reasoning": "<brief summary of the evaluation>"
}

The criteria_scores array must contain exactly one entry for each criterion: ${criteriaIds}.
Each score must be an integer from 1 to 5.
Return ONLY the JSON object, no other text.`
}

async function executeLlmJudge(
  context: EvalContext,
  rubricId: string,
  judgeModel: string
): Promise<LlmJudgeResult> {
  const rubric = await findRubricById(rubricId)
  if (!rubric) {
    throw new Error(`Rubric not found: ${rubricId}`)
  }

  const criteria = JSON.parse(rubric.criteria_json) as RubricCriterion[]
  const prompt = buildJudgePrompt(context, criteria)

  const startTime = Date.now()

  // Use the OpenRouter-compatible inference path
  // Import the gateway settings to get the API key
  const { getDb } = await import('@nitejar/database')
  const db = getDb()
  const gateway = await db
    .selectFrom('gateway_settings')
    .selectAll()
    .where('id', '=', 'default')
    .executeTakeFirst()

  if (!gateway?.api_key_encrypted) {
    throw new Error('Gateway API key not configured — cannot run LLM judge')
  }

  const { decrypt } = await import('@nitejar/database')
  const apiKey = decrypt(gateway.api_key_encrypted)
  const baseUrl = gateway.base_url || 'https://openrouter.ai/api/v1'

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: judgeModel,
      messages: [
        {
          role: 'system',
          content:
            'You are an independent quality evaluator. Return only valid JSON with no additional text.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  })

  const durationMs = Date.now() - startTime

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Judge model request failed (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('Judge model returned empty response')
  }

  const inputTokenCount = data.usage?.prompt_tokens ?? 0
  const outputTokenCount = data.usage?.completion_tokens ?? 0

  // Estimate cost (rough: $0.15/1M input, $0.60/1M output for gpt-4o-mini)
  const costUsd = inputTokenCount * 0.00000015 + outputTokenCount * 0.0000006

  // Record the judge call in inference_calls so it shows up in cost reporting
  await insertInferenceCall({
    job_id: context.jobId,
    agent_id: context.agentId,
    turn: 0,
    model: judgeModel,
    prompt_tokens: inputTokenCount,
    completion_tokens: outputTokenCount,
    total_tokens: inputTokenCount + outputTokenCount,
    cost_usd: costUsd,
    tool_call_names: null,
    finish_reason: 'stop',
    is_fallback: 0,
    duration_ms: durationMs,
    attempt_kind: 'eval_judge',
  })

  // Parse the judge's response
  let parsed: { criteria_scores: CriterionScore[]; overall_reasoning: string }
  try {
    parsed = JSON.parse(content) as {
      criteria_scores: CriterionScore[]
      overall_reasoning: string
    }
  } catch {
    throw new Error(`Failed to parse judge response as JSON: ${content.slice(0, 500)}`)
  }

  const criteriaScores = parsed.criteria_scores ?? []

  // Calculate weighted average score (1-5 scale)
  let totalWeight = 0
  let weightedSum = 0
  for (const cs of criteriaScores) {
    const criterion = criteria.find((c) => c.id === cs.criterion_id)
    const weight = criterion?.weight ?? 1
    const score = Math.max(1, Math.min(5, Math.round(cs.score)))
    totalWeight += weight
    weightedSum += score * weight
  }

  const rawScore = totalWeight > 0 ? weightedSum / totalWeight : 3
  const normalizedScore = (rawScore - 1) / 4 // Normalize to 0-1

  return {
    criteriaScores,
    judgeReasoning: parsed.overall_reasoning ?? '',
    judgeModel,
    normalizedScore,
    rawScore,
    costUsd,
    inputTokenCount,
    outputTokenCount,
    durationMs,
  }
}

// ============================================================================
// Pipeline execution
// ============================================================================

async function processEvalRun(): Promise<void> {
  const workerId = `eval-worker:${process.pid}`
  const evalRun = await claimPendingEvalRun(workerId, LEASE_SECONDS)
  if (!evalRun) return

  try {
    // Load eval context
    const context = await assembleEvalContext(
      evalRun.job_id,
      evalRun.agent_id,
      evalRun.work_item_id
    )
    if (!context) {
      await updateEvalRun(evalRun.id, {
        status: 'failed',
        error_text: 'Failed to assemble eval context (missing job, work item, or agent)',
        completed_at: Math.floor(Date.now() / 1000),
      })
      return
    }

    // Load active evaluators for the agent
    const assignments = await listActiveEvaluatorsForAgent(evalRun.agent_id)
    if (assignments.length === 0) {
      await updateEvalRun(evalRun.id, {
        status: 'completed',
        overall_score: null,
        gates_passed: 1,
        pipeline_result_json: JSON.stringify({ message: 'No active evaluators' }),
        completed_at: Math.floor(Date.now() / 1000),
      })
      return
    }

    const settings = await getEvalSettings()
    const gates = assignments.filter((a) => a.is_gate === 1)
    const scorers = assignments.filter((a) => a.is_gate === 0)

    let totalCost = 0
    let gatesPassed = true
    const pipelineGates: Array<{
      evaluatorId: string
      evaluatorName: string
      passed: boolean
    }> = []
    const pipelineScorers: Array<{
      evaluatorId: string
      evaluatorName: string
      score: number | null
      weight: number
    }> = []

    // Phase 1: Gates
    for (const gate of gates) {
      // Check per-evaluator sample rate
      if (gate.sample_rate !== null && Math.random() >= gate.sample_rate) {
        continue
      }

      if (gate.evaluator_type === 'llm_judge') {
        // For v1, LLM judge gates work the same as scorers but pass/fail based on threshold
        try {
          const config = JSON.parse(gate.evaluator_config_json) as { rubric_id: string }
          const rubric = await findRubricById(config.rubric_id)
          const judgeModel = resolveJudgeModel(
            context.agentModel,
            gate.evaluator_judge_model,
            rubric?.judge_model ?? null,
            settings.judge_model
          )

          const result = await executeLlmJudge(context, config.rubric_id, judgeModel)
          totalCost += result.costUsd

          const passed = result.normalizedScore >= 0.5 // Gate passes if score >= 50%
          gatesPassed = gatesPassed && passed

          await createEvalResult({
            eval_run_id: evalRun.id,
            evaluator_id: gate.evaluator_id,
            result_type: 'pass_fail',
            score: result.normalizedScore,
            passed: passed ? 1 : 0,
            details_json: JSON.stringify({
              criteria_scores: result.criteriaScores,
              judge_reasoning: result.judgeReasoning,
              judge_model: result.judgeModel,
              input_token_count: result.inputTokenCount,
              output_token_count: result.outputTokenCount,
            }),
            evaluator_config_snapshot_json: JSON.stringify({
              type: gate.evaluator_type,
              config: JSON.parse(gate.evaluator_config_json) as unknown,
              rubric_criteria: rubric ? (JSON.parse(rubric.criteria_json) as unknown) : null,
            }),
            cost_usd: result.costUsd,
            duration_ms: result.durationMs,
          })

          pipelineGates.push({
            evaluatorId: gate.evaluator_id,
            evaluatorName: gate.evaluator_name,
            passed,
          })

          if (!passed) break // Stop gates on first failure
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[EvalWorker] Gate evaluator ${gate.evaluator_id} failed:`, message)
          gatesPassed = false
          pipelineGates.push({
            evaluatorId: gate.evaluator_id,
            evaluatorName: gate.evaluator_name,
            passed: false,
          })
          break
        }
      }
      // Other gate types are schema-only for v1
    }

    // Phase 2: Scorers (only if gates passed)
    if (gatesPassed) {
      for (const scorer of scorers) {
        // Check per-evaluator sample rate
        if (scorer.sample_rate !== null && Math.random() >= scorer.sample_rate) {
          continue
        }

        if (scorer.evaluator_type === 'llm_judge') {
          try {
            const config = JSON.parse(scorer.evaluator_config_json) as { rubric_id: string }
            const rubric = await findRubricById(config.rubric_id)
            const judgeModel = resolveJudgeModel(
              context.agentModel,
              scorer.evaluator_judge_model,
              rubric?.judge_model ?? null,
              settings.judge_model
            )

            const result = await executeLlmJudge(context, config.rubric_id, judgeModel)
            totalCost += result.costUsd

            await createEvalResult({
              eval_run_id: evalRun.id,
              evaluator_id: scorer.evaluator_id,
              result_type: 'score',
              score: result.normalizedScore,
              passed: null,
              details_json: JSON.stringify({
                criteria_scores: result.criteriaScores,
                judge_reasoning: result.judgeReasoning,
                judge_model: result.judgeModel,
                input_token_count: result.inputTokenCount,
                output_token_count: result.outputTokenCount,
              }),
              evaluator_config_snapshot_json: JSON.stringify({
                type: scorer.evaluator_type,
                config: JSON.parse(scorer.evaluator_config_json) as unknown,
                rubric_criteria: rubric ? (JSON.parse(rubric.criteria_json) as unknown) : null,
              }),
              cost_usd: result.costUsd,
              duration_ms: result.durationMs,
            })

            pipelineScorers.push({
              evaluatorId: scorer.evaluator_id,
              evaluatorName: scorer.evaluator_name,
              score: result.normalizedScore,
              weight: scorer.weight,
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.warn(`[EvalWorker] Scorer evaluator ${scorer.evaluator_id} failed:`, message)
            pipelineScorers.push({
              evaluatorId: scorer.evaluator_id,
              evaluatorName: scorer.evaluator_name,
              score: null,
              weight: scorer.weight,
            })
          }
        }
        // Other scorer types are schema-only for v1
      }
    }

    // Compose overall score (weighted average of scoring evaluators)
    let overallScore: number | null = null
    if (gatesPassed) {
      let totalWeight = 0
      let weightedSum = 0
      for (const s of pipelineScorers) {
        if (s.score !== null) {
          totalWeight += s.weight
          weightedSum += s.score * s.weight
        }
      }
      if (totalWeight > 0) {
        overallScore = weightedSum / totalWeight
      }
    }

    await updateEvalRun(evalRun.id, {
      status: 'completed',
      overall_score: overallScore,
      gates_passed: gatesPassed ? 1 : 0,
      pipeline_result_json: JSON.stringify({
        gates: pipelineGates,
        scorers: pipelineScorers,
      }),
      total_cost_usd: totalCost,
      completed_at: Math.floor(Date.now() / 1000),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[EvalWorker] Pipeline failed:', message)
    await updateEvalRun(evalRun.id, {
      status: 'failed',
      error_text: message,
      completed_at: Math.floor(Date.now() / 1000),
    })
  }
}

// ============================================================================
// Worker lifecycle
// ============================================================================

export const __evalWorkerTest = {
  processEvalRun,
}

export function ensureEvalWorker(): void {
  const state = getState()
  state.processFn = processEvalRun

  if (state.started) return
  state.started = true

  const tick = async () => {
    if (state.running || state.draining) return
    state.running = true
    try {
      await state.processFn!()
    } catch (error) {
      if (logSchemaMismatchOnce(error, 'EvalWorker')) {
        stopEvalWorker()
        return
      }
      console.warn('[EvalWorker] Tick failed', error)
    } finally {
      state.running = false
    }
  }

  void tick()
  state.timer = setInterval(() => {
    void tick()
  }, TICK_MS)

  if (typeof state.timer.unref === 'function') {
    state.timer.unref()
  }

  console.log('[EvalWorker] Started')
}

export function stopEvalWorker(): void {
  const state = getState()
  state.draining = true
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = undefined
  }
}

export function isEvalWorkerBusy(): boolean {
  return getState().running
}
