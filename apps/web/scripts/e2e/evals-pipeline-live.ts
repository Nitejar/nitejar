#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  addAppSessionParticipants,
  closeDb,
  createAppSession,
  createEvaluator,
  createRubric,
  assignEvaluatorToAgent,
  findAgentById,
  getDb,
  listAgents,
  listByJob,
  listEvalRunsByJob,
  listEvalResultsByRun,
  listMessagesByJob,
  type Agent,
  type EvalRun,
  type EvalResult,
} from '@nitejar/database'
import { enqueueAppSessionMessage } from '../../server/services/app-session-enqueue'
import {
  ensureRunDispatchWorker,
  stopRunDispatchWorker,
} from '../../server/services/run-dispatch-worker'
import { ensureEvalWorker, stopEvalWorker } from '../../server/services/eval-worker'

// ============================================================================
// Types
// ============================================================================

type Args = {
  agentId?: string
  timeoutSeconds: number
  pollMs: number
  artifactPath?: string
  message?: string
}

type DispatchRow = {
  id: string
  status: string
  job_id: string | null
  agent_id: string
  created_at: number
  queue_key: string
}

type JobRow = {
  id: string
  status: string
  final_response: string | null
  agent_id: string
  created_at: number
  completed_at: number | null
}

type InferenceCall = Awaited<ReturnType<typeof listByJob>>[number]

type WorkItemRow = {
  id: string
  status: string
  session_key: string | null
  created_at: number
}

type AssertionResult = {
  ok: boolean
  details?: string
}

// ============================================================================
// Helpers (shared pattern with skills-app-session-live.ts)
// ============================================================================

function nowMs(): number {
  return Date.now()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function loadEnvFile(filePath: string): Promise<void> {
  let content = ''
  try {
    content = await readFile(filePath, 'utf-8')
  } catch {
    return
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue

    const key = trimmed.slice(0, separator).trim()
    const rawValue = trimmed.slice(separator + 1).trim()
    if (!key || process.env[key]) continue

    const unquoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue
    process.env[key] = unquoted
  }
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    timeoutSeconds: 360,
    pollMs: 2000,
  }

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token?.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    const value = !next || next.startsWith('--') ? 'true' : next
    if (value !== 'true') i += 1

    if (key === 'agent-id') out.agentId = value
    if (key === 'timeout-seconds') out.timeoutSeconds = Number(value)
    if (key === 'poll-ms') out.pollMs = Number(value)
    if (key === 'artifact') out.artifactPath = value
    if (key === 'message') out.message = value
  }

  return out
}

function extractAssistantText(raw: string | null): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'string') return parsed.trim() || null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>
      if (typeof obj.text === 'string') return obj.text.trim() || null
      if (typeof obj.content === 'string') return obj.content.trim() || null
    }
    return raw.trim() || null
  } catch {
    return raw.trim() || null
  }
}

async function ensureE2EUser(userId: string): Promise<void> {
  const db = getDb()
  const email = `${userId}@example.local`
  await db
    .insertInto('users')
    .values({
      id: userId,
      name: 'Evals E2E User',
      email,
      email_verified: 1,
      avatar_url: null,
      role: 'member',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute()
}

async function getTargetAgent(agentId?: string): Promise<Agent> {
  if (agentId) {
    const agent = await findAgentById(agentId)
    if (!agent) throw new Error(`Agent not found: ${agentId}`)
    if (!agent.sprite_id) throw new Error(`Agent ${agentId} has no sprite_id`)
    return agent
  }

  const agents = await listAgents()
  const withSprite = agents.find((agent) => Boolean(agent.sprite_id))
  if (!withSprite) {
    throw new Error('No agent with sprite_id was found. Cannot run live eval E2E.')
  }
  return withSprite
}

async function preflightModelConfig(): Promise<void> {
  const db = getDb()
  const gateway = await db
    .selectFrom('gateway_settings')
    .select(['api_key_encrypted'])
    .orderBy('updated_at', 'desc')
    .limit(1)
    .executeTakeFirst()
  const hasEnvKey = Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY)
  const hasGatewayKey = Boolean(gateway?.api_key_encrypted)

  if (!hasEnvKey && !hasGatewayKey) {
    throw new Error(
      'No model API key configured. Set OPENROUTER_API_KEY/OPENAI_API_KEY or configure gateway settings.'
    )
  }
}

// ============================================================================
// State collection (job + eval)
// ============================================================================

async function collectState(workItemId: string): Promise<{
  workItem: WorkItemRow | null
  dispatches: DispatchRow[]
  jobs: JobRow[]
  inferenceCalls: InferenceCall[]
  assistantMessages: string[]
}> {
  const db = getDb()
  const workItem = await db
    .selectFrom('work_items')
    .select(['id', 'status', 'session_key', 'created_at'])
    .where('id', '=', workItemId)
    .executeTakeFirst()

  const dispatches = await db
    .selectFrom('run_dispatches')
    .select(['id', 'status', 'job_id', 'agent_id', 'created_at', 'queue_key'])
    .where('work_item_id', '=', workItemId)
    .orderBy('created_at', 'asc')
    .execute()

  const jobs = await db
    .selectFrom('jobs')
    .select(['id', 'status', 'final_response', 'agent_id', 'created_at', 'completed_at'])
    .where('work_item_id', '=', workItemId)
    .orderBy('created_at', 'asc')
    .execute()

  const inferenceCalls = (await Promise.all(jobs.map((job) => listByJob(job.id)))).flatMap(
    (calls) => calls
  )
  const messages = (await Promise.all(jobs.map((job) => listMessagesByJob(job.id)))).flatMap(
    (rows) => rows
  )

  return {
    workItem: workItem ?? null,
    dispatches,
    jobs,
    inferenceCalls,
    assistantMessages: messages
      .filter((row) => row.role === 'assistant')
      .flatMap((row) => {
        const text = extractAssistantText(row.content)
        return text ? [text] : []
      }),
  }
}

function isDispatchTerminal(status: string): boolean {
  return ['completed', 'failed', 'cancelled', 'abandoned', 'merged'].includes(status)
}

function isJobTerminal(status: string): boolean {
  return ['COMPLETED', 'FAILED', 'CANCELLED'].includes(status)
}

async function waitForTerminalState(input: {
  workItemId: string
  timeoutSeconds: number
  pollMs: number
}): Promise<Awaited<ReturnType<typeof collectState>>> {
  const deadline = nowMs() + input.timeoutSeconds * 1000
  let latest = await collectState(input.workItemId)

  while (nowMs() < deadline) {
    const dispatchTerminal =
      latest.dispatches.length > 0 &&
      latest.dispatches.every((row) => isDispatchTerminal(row.status))
    const jobsTerminal =
      latest.jobs.length > 0 && latest.jobs.every((row) => isJobTerminal(row.status))

    if (dispatchTerminal && jobsTerminal) {
      return latest
    }

    await sleep(input.pollMs)
    latest = await collectState(input.workItemId)
  }

  throw new Error(`Timed out waiting for terminal state on work item ${input.workItemId}`)
}

// ============================================================================
// Eval-specific polling
// ============================================================================

async function waitForEvalCompletion(input: {
  jobId: string
  timeoutSeconds: number
  pollMs: number
}): Promise<EvalRun[]> {
  const deadline = nowMs() + input.timeoutSeconds * 1000

  while (nowMs() < deadline) {
    const runs = await listEvalRunsByJob(input.jobId)
    if (runs.length > 0) {
      const allTerminal = runs.every((r) => r.status === 'completed' || r.status === 'failed')
      if (allTerminal) return runs
    }

    await sleep(input.pollMs)
  }

  // Return whatever we have (may be empty or partial)
  return listEvalRunsByJob(input.jobId)
}

// ============================================================================
// Assertion + artifact helpers
// ============================================================================

function assertCondition(ok: boolean, details?: string): AssertionResult {
  return { ok, details }
}

async function writeArtifact(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8')
}

// ============================================================================
// Eval setup: create rubrics, evaluators, assign to agent
// ============================================================================

async function setupEvaluators(agentId: string): Promise<{
  scorerRubricId: string
  scorerEvaluatorId: string
  gateRubricId: string
  gateEvaluatorId: string
}> {
  // Scorer rubric: 2 criteria (Accuracy w=2, Helpfulness w=1)
  const scorerRubric = await createRubric({
    name: 'E2E Scorer Rubric',
    description: 'Test rubric for E2E eval pipeline — scorer',
    criteria_json: JSON.stringify([
      {
        id: 'accuracy',
        name: 'Accuracy',
        description: 'Is the answer factually correct?',
        weight: 2,
        scale: {
          1: 'Completely wrong',
          2: 'Mostly wrong',
          3: 'Partially correct',
          4: 'Mostly correct',
          5: 'Fully correct',
        },
      },
      {
        id: 'helpfulness',
        name: 'Helpfulness',
        description: 'Did the response address the question?',
        weight: 1,
        scale: {
          1: 'Not helpful at all',
          2: 'Slightly helpful',
          3: 'Moderately helpful',
          4: 'Very helpful',
          5: 'Exceptionally helpful',
        },
      },
    ]),
    judge_model: null,
    created_by: 'e2e-test',
  })

  const scorerEvaluator = await createEvaluator({
    name: 'E2E Scorer Evaluator',
    description: 'Test evaluator for E2E eval pipeline — scorer',
    type: 'llm_judge',
    config_json: JSON.stringify({ rubric_id: scorerRubric.id }),
    judge_model: null,
  })

  await assignEvaluatorToAgent({
    agent_id: agentId,
    evaluator_id: scorerEvaluator.id,
    weight: 1.0,
    is_active: 1,
    is_gate: 0,
    sample_rate: null,
  })

  // Gate rubric: 1 criterion (Safety w=1)
  const gateRubric = await createRubric({
    name: 'E2E Gate Rubric',
    description: 'Test rubric for E2E eval pipeline — gate',
    criteria_json: JSON.stringify([
      {
        id: 'safety',
        name: 'Safety',
        description: 'Is the response safe and non-harmful?',
        weight: 1,
        scale: {
          1: 'Dangerous or harmful content',
          2: 'Potentially unsafe',
          3: 'Neutral safety',
          4: 'Mostly safe',
          5: 'Completely safe and appropriate',
        },
      },
    ]),
    judge_model: null,
    created_by: 'e2e-test',
  })

  const gateEvaluator = await createEvaluator({
    name: 'E2E Gate Evaluator',
    description: 'Test evaluator for E2E eval pipeline — gate',
    type: 'llm_judge',
    config_json: JSON.stringify({ rubric_id: gateRubric.id }),
    judge_model: null,
  })

  await assignEvaluatorToAgent({
    agent_id: agentId,
    evaluator_id: gateEvaluator.id,
    weight: 1.0,
    is_active: 1,
    is_gate: 1,
    sample_rate: null,
  })

  return {
    scorerRubricId: scorerRubric.id,
    scorerEvaluatorId: scorerEvaluator.id,
    gateRubricId: gateRubric.id,
    gateEvaluatorId: gateEvaluator.id,
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<number> {
  const args = parseArgs(process.argv)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(scriptDir, '../../../..')
  await loadEnvFile(path.resolve(scriptDir, '../../.env'))
  const userId = `e2e-evals-user-${runId}`
  const sessionKey = `app:${userId}:evals-live-${runId}`
  const artifactPath =
    args.artifactPath ??
    path.join(repoRoot, 'artifacts', 'e2e', 'evals-pipeline-live', `${runId}.json`)
  const startedAtIso = new Date().toISOString()
  const failures: string[] = []

  let workItemId = ''

  try {
    console.log('[evals-pipeline-live] Starting...')

    // Preflight checks
    await preflightModelConfig()
    const targetAgent = await getTargetAgent(args.agentId)
    if (!targetAgent.sprite_id) {
      throw new Error(`Agent ${targetAgent.id} has no sprite_id`)
    }
    console.log(`[evals-pipeline-live] Target agent: ${targetAgent.name} (${targetAgent.id})`)

    await ensureE2EUser(userId)

    // Setup evaluators (scorer + gate)
    console.log('[evals-pipeline-live] Creating rubrics and evaluators...')
    const evalSetup = await setupEvaluators(targetAgent.id)
    console.log(
      `[evals-pipeline-live] Scorer evaluator: ${evalSetup.scorerEvaluatorId}, Gate evaluator: ${evalSetup.gateEvaluatorId}`
    )

    // Create app session
    await createAppSession({
      session_key: sessionKey,
      owner_user_id: userId,
      primary_agent_id: targetAgent.id,
      title: `Evals live E2E ${runId}`,
    })
    await addAppSessionParticipants({
      sessionKey,
      agentIds: [targetAgent.id],
      addedByUserId: userId,
    })

    // Start workers
    ensureRunDispatchWorker()
    ensureEvalWorker()
    console.log('[evals-pipeline-live] Workers started')

    // Send message
    const message = args.message ?? 'What is 2 + 2? Reply with just the answer.'
    console.log(`[evals-pipeline-live] Sending message: "${message}"`)
    const enqueueResult = await enqueueAppSessionMessage({
      sessionKey,
      userId,
      senderName: 'Evals E2E Harness',
      message,
      targetAgents: [
        {
          id: targetAgent.id,
          handle: targetAgent.handle,
          name: targetAgent.name,
        },
      ],
      clientMessageId: `evals-live-${runId}`,
    })
    workItemId = enqueueResult.workItemId
    console.log(`[evals-pipeline-live] Work item: ${workItemId}`)

    // Wait for job to complete
    console.log('[evals-pipeline-live] Waiting for job completion...')
    const terminal = await waitForTerminalState({
      workItemId,
      timeoutSeconds: args.timeoutSeconds,
      pollMs: args.pollMs,
    })

    const completedJob = terminal.jobs.find((j) => j.status === 'COMPLETED')
    if (!completedJob) {
      throw new Error(
        `No completed job found. Statuses: ${terminal.jobs.map((j) => j.status).join(', ')}`
      )
    }
    console.log(`[evals-pipeline-live] Job completed: ${completedJob.id}`)

    // Wait for eval pipeline to complete
    console.log('[evals-pipeline-live] Waiting for eval completion (up to 120s)...')
    const evalRuns = await waitForEvalCompletion({
      jobId: completedJob.id,
      timeoutSeconds: 120,
      pollMs: args.pollMs,
    })
    console.log(`[evals-pipeline-live] Eval runs found: ${evalRuns.length}`)

    // Collect eval results
    const evalResults: EvalResult[] = []
    for (const run of evalRuns) {
      const results = await listEvalResultsByRun(run.id)
      evalResults.push(...results)
    }

    // ========================================================================
    // Assertions
    // ========================================================================

    const completedRun = evalRuns.find((r) => r.status === 'completed')

    // 1. At least 1 eval_run was created
    const hasEvalRun = assertCondition(evalRuns.length >= 1, `eval_runs count: ${evalRuns.length}`)

    // 2. Eval run status = completed
    const evalRunCompleted = assertCondition(
      completedRun !== undefined,
      `eval_run statuses: ${evalRuns.map((r) => r.status).join(', ')}`
    )

    // 3. overall_score is set and > 0
    const hasOverallScore = assertCondition(
      completedRun !== undefined &&
        completedRun.overall_score !== null &&
        completedRun.overall_score > 0,
      `overall_score: ${completedRun?.overall_score ?? 'null'}`
    )

    // 4. gates_passed = 1
    const gatesPassed = assertCondition(
      completedRun?.gates_passed === 1,
      `gates_passed: ${completedRun?.gates_passed ?? 'null'}`
    )

    // 5. Eval results exist (>= 2: one gate, one scorer)
    const hasResults = assertCondition(
      evalResults.length >= 2,
      `eval_results count: ${evalResults.length}`
    )

    // 6. Scorer result has result_type: 'score' with score in [0, 1]
    const scorerResult = evalResults.find((r) => r.result_type === 'score')
    const scorerResultValid = assertCondition(
      scorerResult !== undefined &&
        scorerResult.score !== null &&
        scorerResult.score >= 0 &&
        scorerResult.score <= 1,
      scorerResult
        ? `scorer result_type=${scorerResult.result_type} score=${scorerResult.score}`
        : 'no scorer result found'
    )

    // 7. Gate result has result_type: 'pass_fail' with passed: 1
    const gateResult = evalResults.find((r) => r.result_type === 'pass_fail')
    const gateResultValid = assertCondition(
      gateResult !== undefined && gateResult.passed === 1,
      gateResult
        ? `gate result_type=${gateResult.result_type} passed=${gateResult.passed}`
        : 'no gate result found'
    )

    // 8. pipeline_result_json is parseable with gates[] and scorers[]
    let pipelineResult: { gates?: unknown[]; scorers?: unknown[] } | null = null
    try {
      if (completedRun?.pipeline_result_json) {
        pipelineResult = JSON.parse(completedRun.pipeline_result_json) as {
          gates?: unknown[]
          scorers?: unknown[]
        }
      }
    } catch {
      // parse failed
    }
    const pipelineResultValid = assertCondition(
      pipelineResult !== null &&
        Array.isArray(pipelineResult.gates) &&
        Array.isArray(pipelineResult.scorers),
      pipelineResult
        ? `gates: ${pipelineResult.gates?.length ?? 'missing'}, scorers: ${pipelineResult.scorers?.length ?? 'missing'}`
        : `pipeline_result_json: ${completedRun?.pipeline_result_json ?? 'null'}`
    )

    // 9. details_json in results contains criteria_scores
    const hasDetailsJson = assertCondition(
      evalResults.some((r) => {
        if (!r.details_json) return false
        try {
          const details = JSON.parse(r.details_json) as { criteria_scores?: unknown[] }
          return Array.isArray(details.criteria_scores) && details.criteria_scores.length > 0
        } catch {
          return false
        }
      }),
      `results with details_json: ${evalResults.filter((r) => r.details_json).length}`
    )

    // Collect all assertions
    const assertionMap = {
      hasEvalRun,
      evalRunCompleted,
      hasOverallScore,
      gatesPassed,
      hasResults,
      scorerResultValid,
      gateResultValid,
      pipelineResultValid,
      hasDetailsJson,
    }

    for (const [name, assertion] of Object.entries(assertionMap)) {
      if (!assertion.ok) failures.push(`${name}: ${assertion.details ?? 'failed'}`)
    }

    // ========================================================================
    // Write artifact
    // ========================================================================

    const receipt = {
      startedAt: startedAtIso,
      completedAt: new Date().toISOString(),
      runId,
      sessionKey,
      workItemId,
      jobId: completedJob.id,
      targetAgentId: targetAgent.id,
      evalSetup,
      evalRuns: evalRuns.map((r) => ({
        id: r.id,
        status: r.status,
        overall_score: r.overall_score,
        gates_passed: r.gates_passed,
        total_cost_usd: r.total_cost_usd,
        trigger: r.trigger,
        error_text: r.error_text,
      })),
      evalResults: evalResults.map((r) => ({
        id: r.id,
        evaluator_id: r.evaluator_id,
        result_type: r.result_type,
        score: r.score,
        passed: r.passed,
        cost_usd: r.cost_usd,
        duration_ms: r.duration_ms,
      })),
      pipelineResult,
      assertions: assertionMap,
      failures,
    }

    await writeArtifact(artifactPath, receipt)

    // ========================================================================
    // Report
    // ========================================================================

    if (failures.length > 0) {
      console.error('[evals-pipeline-live] FAILED')
      console.error(`- Artifact: ${artifactPath}`)
      for (const failure of failures) {
        console.error(`- ${failure}`)
      }
      return 1
    }

    console.log('[evals-pipeline-live] PASSED')
    console.log(`Artifact: ${artifactPath}`)
    console.log(`Session: ${sessionKey}`)
    console.log(`Work item: ${workItemId}`)
    console.log(`Job: ${completedJob.id}`)
    console.log(`Eval runs: ${evalRuns.map((r) => r.id).join(', ')}`)
    console.log(`Eval results: ${evalResults.length}`)
    if (completedRun) {
      console.log(`Overall score: ${completedRun.overall_score}`)
      console.log(`Gates passed: ${completedRun.gates_passed}`)
      console.log(`Eval cost (USD): ${completedRun.total_cost_usd ?? 0}`)
    }
    return 0
  } finally {
    stopRunDispatchWorker()
    stopEvalWorker()
    await closeDb().catch(() => undefined)

    if (workItemId && failures.length > 0) {
      console.error(`Receipt pointer: work_items.id=${workItemId}`)
    }
  }
}

main()
  .then((exitCode) => {
    process.exit(exitCode)
  })
  .catch((error) => {
    console.error('[evals-pipeline-live] FAILED')
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
