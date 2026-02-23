import { sql } from 'kysely'
import { getDb } from '../db'
import type {
  Rubric,
  NewRubric,
  Evaluator,
  NewEvaluator,
  AgentEvaluator,
  EvalRun,
  NewEvalRun,
  EvalResult,
  NewEvalResult,
  EvalSettings,
  EvalSettingsUpdate,
} from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

// ============================================================================
// Rubrics
// ============================================================================

export async function createRubric(
  data: Omit<NewRubric, 'id' | 'created_at' | 'updated_at'>
): Promise<Rubric> {
  const db = getDb()
  const id = uuid()
  const timestamp = now()
  return db
    .insertInto('rubrics')
    .values({ id, ...data, created_at: timestamp, updated_at: timestamp })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function findRubricById(id: string): Promise<Rubric | null> {
  const db = getDb()
  const result = await db.selectFrom('rubrics').selectAll().where('id', '=', id).executeTakeFirst()
  return result ?? null
}

export async function listRubrics(): Promise<Rubric[]> {
  const db = getDb()
  return db.selectFrom('rubrics').selectAll().orderBy('created_at', 'desc').execute()
}

export async function updateRubric(
  id: string,
  data: {
    name?: string
    description?: string | null
    criteria_json?: string
    judge_model?: string | null
  }
): Promise<Rubric | null> {
  const db = getDb()
  const existing = await findRubricById(id)
  if (!existing) return null

  const updates: Record<string, unknown> = { updated_at: now() }
  if (data.name !== undefined) updates.name = data.name
  if (data.description !== undefined) updates.description = data.description
  if (data.judge_model !== undefined) updates.judge_model = data.judge_model
  if (data.criteria_json !== undefined) {
    updates.criteria_json = data.criteria_json
    updates.version = existing.version + 1
  }

  const result = await db
    .updateTable('rubrics')
    .set(updates)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}

export async function deleteRubric(id: string): Promise<boolean> {
  const db = getDb()
  const result = await db.deleteFrom('rubrics').where('id', '=', id).executeTakeFirst()
  return (result.numDeletedRows ?? 0n) > 0n
}

// ============================================================================
// Evaluators
// ============================================================================

export async function createEvaluator(
  data: Omit<NewEvaluator, 'id' | 'created_at' | 'updated_at'>
): Promise<Evaluator> {
  const db = getDb()
  const id = uuid()
  const timestamp = now()
  return db
    .insertInto('evaluators')
    .values({ id, ...data, created_at: timestamp, updated_at: timestamp })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function findEvaluatorById(id: string): Promise<Evaluator | null> {
  const db = getDb()
  const result = await db
    .selectFrom('evaluators')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return result ?? null
}

export async function listEvaluators(options?: { type?: string }): Promise<Evaluator[]> {
  const db = getDb()
  let query = db.selectFrom('evaluators').selectAll().orderBy('created_at', 'desc')
  if (options?.type) {
    query = query.where('type', '=', options.type)
  }
  return query.execute()
}

export async function updateEvaluator(
  id: string,
  data: {
    name?: string
    description?: string | null
    config_json?: string
    judge_model?: string | null
  }
): Promise<Evaluator | null> {
  const db = getDb()
  const updates: Record<string, unknown> = { updated_at: now() }
  if (data.name !== undefined) updates.name = data.name
  if (data.description !== undefined) updates.description = data.description
  if (data.config_json !== undefined) updates.config_json = data.config_json
  if (data.judge_model !== undefined) updates.judge_model = data.judge_model

  const result = await db
    .updateTable('evaluators')
    .set(updates)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}

export async function deleteEvaluator(id: string): Promise<boolean> {
  const db = getDb()
  const result = await db.deleteFrom('evaluators').where('id', '=', id).executeTakeFirst()
  return (result.numDeletedRows ?? 0n) > 0n
}

/** Find the evaluator of type llm_judge that references a given rubric_id in its config_json */
export async function findEvaluatorByRubricId(rubricId: string): Promise<Evaluator | null> {
  const db = getDb()
  // config_json is stored as JSON string like {"rubric_id":"..."}
  const result = await db
    .selectFrom('evaluators')
    .selectAll()
    .where('type', '=', 'llm_judge')
    .where('config_json', 'like', `%"rubric_id":"${rubricId}"%`)
    .executeTakeFirst()
  return result ?? null
}

// ============================================================================
// Agent Evaluators (assignments)
// ============================================================================

export async function assignEvaluatorToAgent(data: {
  agent_id: string
  evaluator_id: string
  weight?: number
  is_active?: number
  is_gate?: number
  sample_rate?: number | null
}): Promise<AgentEvaluator> {
  const db = getDb()
  const id = uuid()
  const timestamp = now()
  return db
    .insertInto('agent_evaluators')
    .values({
      id,
      agent_id: data.agent_id,
      evaluator_id: data.evaluator_id,
      weight: data.weight ?? 1.0,
      is_active: data.is_active ?? 1,
      is_gate: data.is_gate ?? 0,
      sample_rate: data.sample_rate ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function findAgentEvaluatorById(id: string): Promise<AgentEvaluator | null> {
  const db = getDb()
  const result = await db
    .selectFrom('agent_evaluators')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return result ?? null
}

export async function updateAgentEvaluator(
  id: string,
  data: {
    weight?: number
    is_active?: number
    is_gate?: number
    sample_rate?: number | null
  }
): Promise<AgentEvaluator | null> {
  const db = getDb()
  const updates: Record<string, unknown> = { updated_at: now() }
  if (data.weight !== undefined) updates.weight = data.weight
  if (data.is_active !== undefined) updates.is_active = data.is_active
  if (data.is_gate !== undefined) updates.is_gate = data.is_gate
  if (data.sample_rate !== undefined) updates.sample_rate = data.sample_rate

  const result = await db
    .updateTable('agent_evaluators')
    .set(updates)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}

export async function removeEvaluatorFromAgent(id: string): Promise<boolean> {
  const db = getDb()
  const result = await db.deleteFrom('agent_evaluators').where('id', '=', id).executeTakeFirst()
  return (result.numDeletedRows ?? 0n) > 0n
}

export async function listActiveEvaluatorsForAgent(agentId: string): Promise<
  Array<
    AgentEvaluator & {
      evaluator_name: string
      evaluator_type: string
      evaluator_config_json: string
      evaluator_judge_model: string | null
    }
  >
> {
  const db = getDb()
  return db
    .selectFrom('agent_evaluators')
    .innerJoin('evaluators', 'evaluators.id', 'agent_evaluators.evaluator_id')
    .select([
      'agent_evaluators.id',
      'agent_evaluators.agent_id',
      'agent_evaluators.evaluator_id',
      'agent_evaluators.weight',
      'agent_evaluators.is_active',
      'agent_evaluators.sample_rate',
      'agent_evaluators.is_gate',
      'agent_evaluators.created_at',
      'agent_evaluators.updated_at',
      'evaluators.name as evaluator_name',
      'evaluators.type as evaluator_type',
      'evaluators.config_json as evaluator_config_json',
      'evaluators.judge_model as evaluator_judge_model',
    ])
    .where('agent_evaluators.agent_id', '=', agentId)
    .where('agent_evaluators.is_active', '=', 1)
    .orderBy('agent_evaluators.is_gate', 'desc') // gates first
    .orderBy('agent_evaluators.created_at', 'asc')
    .execute()
}

export async function listAgentEvaluators(agentId: string): Promise<
  Array<
    AgentEvaluator & {
      evaluator_name: string
      evaluator_type: string
      evaluator_description: string | null
    }
  >
> {
  const db = getDb()
  return db
    .selectFrom('agent_evaluators')
    .innerJoin('evaluators', 'evaluators.id', 'agent_evaluators.evaluator_id')
    .select([
      'agent_evaluators.id',
      'agent_evaluators.agent_id',
      'agent_evaluators.evaluator_id',
      'agent_evaluators.weight',
      'agent_evaluators.is_active',
      'agent_evaluators.sample_rate',
      'agent_evaluators.is_gate',
      'agent_evaluators.created_at',
      'agent_evaluators.updated_at',
      'evaluators.name as evaluator_name',
      'evaluators.type as evaluator_type',
      'evaluators.description as evaluator_description',
    ])
    .where('agent_evaluators.agent_id', '=', agentId)
    .orderBy('agent_evaluators.is_gate', 'desc')
    .orderBy('agent_evaluators.created_at', 'asc')
    .execute()
}

// ============================================================================
// Eval Runs
// ============================================================================

export async function createEvalRun(
  data: Omit<NewEvalRun, 'id' | 'created_at' | 'updated_at'>
): Promise<EvalRun> {
  const db = getDb()
  const id = uuid()
  const timestamp = now()
  return db
    .insertInto('eval_runs')
    .values({ id, ...data, created_at: timestamp, updated_at: timestamp })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function findEvalRunById(id: string): Promise<EvalRun | null> {
  const db = getDb()
  const result = await db
    .selectFrom('eval_runs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return result ?? null
}

/** Claim a pending eval run for processing (lease-based) */
export async function claimPendingEvalRun(
  _workerId: string,
  _leaseSeconds: number = 120
): Promise<EvalRun | null> {
  const db = getDb()
  const timestamp = now()

  // Find a pending eval run that is not leased
  const pending = await db
    .selectFrom('eval_runs')
    .selectAll()
    .where('status', '=', 'pending')
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst()

  if (!pending) return null

  // Claim it by setting status to running
  const result = await db
    .updateTable('eval_runs')
    .set({
      status: 'running',
      started_at: timestamp,
      updated_at: timestamp,
    })
    .where('id', '=', pending.id)
    .where('status', '=', 'pending')
    .returningAll()
    .executeTakeFirst()

  return result ?? null
}

export async function updateEvalRun(
  id: string,
  data: {
    status?: string
    overall_score?: number | null
    gates_passed?: number | null
    pipeline_result_json?: string | null
    total_cost_usd?: number | null
    error_text?: string | null
    completed_at?: number | null
  }
): Promise<EvalRun | null> {
  const db = getDb()
  const updates: Record<string, unknown> = { updated_at: now() }
  if (data.status !== undefined) updates.status = data.status
  if (data.overall_score !== undefined) updates.overall_score = data.overall_score
  if (data.gates_passed !== undefined) updates.gates_passed = data.gates_passed
  if (data.pipeline_result_json !== undefined)
    updates.pipeline_result_json = data.pipeline_result_json
  if (data.total_cost_usd !== undefined) updates.total_cost_usd = data.total_cost_usd
  if (data.error_text !== undefined) updates.error_text = data.error_text
  if (data.completed_at !== undefined) updates.completed_at = data.completed_at

  const result = await db
    .updateTable('eval_runs')
    .set(updates)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}

export async function listEvalRunsByAgent(
  agentId: string,
  options?: {
    status?: string
    gatesPassed?: boolean
    evaluatorId?: string
    limit?: number
    cursor?: { createdAt: number; id: string }
  }
): Promise<EvalRun[]> {
  const db = getDb()
  let query = db
    .selectFrom('eval_runs')
    .selectAll()
    .where('agent_id', '=', agentId)
    .orderBy('created_at', 'desc')

  if (options?.status) {
    query = query.where('status', '=', options.status)
  }
  if (options?.gatesPassed !== undefined) {
    query = query.where('gates_passed', '=', options.gatesPassed ? 1 : 0)
  }
  if (options?.cursor) {
    query = query.where((eb) =>
      eb.or([
        eb('created_at', '<', options.cursor!.createdAt),
        eb.and([
          eb('created_at', '=', options.cursor!.createdAt),
          eb('id', '<', options.cursor!.id),
        ]),
      ])
    )
  }
  query = query.limit(options?.limit ?? 50)

  return query.execute()
}

export async function listEvalRunsByJob(jobId: string): Promise<EvalRun[]> {
  const db = getDb()
  return db
    .selectFrom('eval_runs')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('created_at', 'desc')
    .execute()
}

export async function countEvalRunsForAgentToday(agentId: string): Promise<number> {
  const db = getDb()
  const startOfDay = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000)
  const result = await db
    .selectFrom('eval_runs')
    .select(sql<number>`count(*)`.as('count'))
    .where('agent_id', '=', agentId)
    .where('created_at', '>=', startOfDay)
    .executeTakeFirstOrThrow()
  return result.count
}

// ============================================================================
// Eval Results
// ============================================================================

export async function createEvalResult(
  data: Omit<NewEvalResult, 'id' | 'created_at'>
): Promise<EvalResult> {
  const db = getDb()
  const id = uuid()
  return db
    .insertInto('eval_results')
    .values({ id, ...data, created_at: now() })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function listEvalResultsByRun(evalRunId: string): Promise<EvalResult[]> {
  const db = getDb()
  return db
    .selectFrom('eval_results')
    .selectAll()
    .where('eval_run_id', '=', evalRunId)
    .orderBy('created_at', 'asc')
    .execute()
}

// ============================================================================
// Eval Settings (singleton)
// ============================================================================

export async function getEvalSettings(): Promise<EvalSettings> {
  const db = getDb()
  const result = await db
    .selectFrom('eval_settings')
    .selectAll()
    .where('id', '=', 'default')
    .executeTakeFirst()

  if (!result) {
    // Should never happen if migration ran, but provide a safe default
    return {
      id: 'default',
      judge_model: null,
      max_daily_evals: 50,
      sample_rate_default: 1.0,
      sample_rate_high_volume_threshold: 20,
      sample_rate_high_volume: 0.2,
      eval_cost_budget_usd: null,
      created_at: now(),
      updated_at: now(),
    }
  }
  return result
}

export async function updateEvalSettings(
  data: Omit<EvalSettingsUpdate, 'id' | 'created_at'>
): Promise<EvalSettings> {
  const db = getDb()
  const result = await db
    .updateTable('eval_settings')
    .set({ ...data, updated_at: now() })
    .where('id', '=', 'default')
    .returningAll()
    .executeTakeFirstOrThrow()
  return result
}

// ============================================================================
// Trend / Aggregation Queries
// ============================================================================

export async function getScoreTrend(
  agentId: string,
  options?: {
    days?: number
    evaluatorId?: string
    evaluatorType?: string
    granularity?: 'day' | 'week'
  }
): Promise<
  Array<{
    date: string
    avg_score: number
    eval_count: number
  }>
> {
  const db = getDb()
  const days = options?.days ?? 30
  const sinceUnix = now() - days * 86400

  const query = db
    .selectFrom('eval_runs')
    .select([
      sql<string>`date(eval_runs.created_at, 'unixepoch')`.as('date'),
      sql<number>`avg(eval_runs.overall_score)`.as('avg_score'),
      sql<number>`count(*)`.as('eval_count'),
    ])
    .where('eval_runs.agent_id', '=', agentId)
    .where('eval_runs.status', '=', 'completed')
    .where('eval_runs.gates_passed', '=', 1)
    .where('eval_runs.created_at', '>=', sinceUnix)
    .groupBy(sql`date(eval_runs.created_at, 'unixepoch')`)
    .orderBy('date', 'asc')

  return query.execute()
}

export async function getAgentEvalSummary(agentId: string): Promise<{
  totalEvals: number
  avgOverallScore: number | null
  gatePassRate: number | null
  lastEvalAt: number | null
  evalCostTotal: number
}> {
  const db = getDb()

  const stats = await db
    .selectFrom('eval_runs')
    .select([
      sql<number>`count(*)`.as('total_evals'),
      sql<number>`avg(case when gates_passed = 1 then overall_score else null end)`.as(
        'avg_overall_score'
      ),
      sql<number>`sum(case when gates_passed = 1 then 1.0 else 0.0 end) / max(count(*), 1)`.as(
        'gate_pass_rate'
      ),
      sql<number>`max(created_at)`.as('last_eval_at'),
      sql<number>`coalesce(sum(total_cost_usd), 0)`.as('eval_cost_total'),
    ])
    .where('agent_id', '=', agentId)
    .where('status', '=', 'completed')
    .executeTakeFirstOrThrow()

  return {
    totalEvals: stats.total_evals,
    avgOverallScore: stats.avg_overall_score,
    gatePassRate: stats.gate_pass_rate,
    lastEvalAt: stats.last_eval_at,
    evalCostTotal: stats.eval_cost_total,
  }
}

/** Compute the trend direction for an agent's eval scores over the last 14 days */
export async function getEvalTrendDirection(agentId: string): Promise<{
  recentAvg: number | null
  recentCount: number
  previousAvg: number | null
  previousCount: number
}> {
  const db = getDb()
  const timestamp = now()
  const sevenDaysAgo = timestamp - 7 * 86400
  const fourteenDaysAgo = timestamp - 14 * 86400

  const [recentResult, previousResult] = await Promise.all([
    db
      .selectFrom('eval_runs')
      .select([sql<number>`avg(overall_score)`.as('avg'), sql<number>`count(*)`.as('cnt')])
      .where('agent_id', '=', agentId)
      .where('status', '=', 'completed')
      .where('gates_passed', '=', 1)
      .where('created_at', '>=', sevenDaysAgo)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('eval_runs')
      .select([sql<number>`avg(overall_score)`.as('avg'), sql<number>`count(*)`.as('cnt')])
      .where('agent_id', '=', agentId)
      .where('status', '=', 'completed')
      .where('gates_passed', '=', 1)
      .where('created_at', '>=', fourteenDaysAgo)
      .where('created_at', '<', sevenDaysAgo)
      .executeTakeFirstOrThrow(),
  ])

  return {
    recentAvg: recentResult.avg,
    recentCount: recentResult.cnt,
    previousAvg: previousResult.avg,
    previousCount: previousResult.cnt,
  }
}

/** Get per-evaluator score/pass-rate stats for an agent */
export async function getEvaluatorStats(
  agentId: string,
  evaluatorId: string
): Promise<{
  avgScore: number | null
  evalCount: number
  passCount: number
}> {
  const db = getDb()
  const result = await db
    .selectFrom('eval_results')
    .innerJoin('eval_runs', 'eval_runs.id', 'eval_results.eval_run_id')
    .select([
      sql<number>`avg(eval_results.score)`.as('avg_score'),
      sql<number>`count(*)`.as('eval_count'),
      sql<number>`sum(case when eval_results.passed = 1 then 1.0 else 0.0 end)`.as('pass_count'),
    ])
    .where('eval_runs.agent_id', '=', agentId)
    .where('eval_runs.status', '=', 'completed')
    .where('eval_results.evaluator_id', '=', evaluatorId)
    .executeTakeFirstOrThrow()

  return {
    avgScore: result.avg_score,
    evalCount: result.eval_count ?? 0,
    passCount: result.pass_count ?? 0,
  }
}

// ============================================================================
// Fleet-wide Aggregation Queries
// ============================================================================

export async function listRecentEvalRuns(options?: {
  agentId?: string
  status?: string
  gatesPassed?: boolean
  limit?: number
  cursor?: { createdAt: number; id: string }
}): Promise<Array<EvalRun & { agent_name: string }>> {
  const db = getDb()
  let query = db
    .selectFrom('eval_runs')
    .innerJoin('agents', 'agents.id', 'eval_runs.agent_id')
    .select([
      'eval_runs.id',
      'eval_runs.job_id',
      'eval_runs.agent_id',
      'eval_runs.work_item_id',
      'eval_runs.trigger',
      'eval_runs.status',
      'eval_runs.overall_score',
      'eval_runs.gates_passed',
      'eval_runs.pipeline_result_json',
      'eval_runs.total_cost_usd',
      'eval_runs.error_text',
      'eval_runs.started_at',
      'eval_runs.completed_at',
      'eval_runs.created_at',
      'eval_runs.updated_at',
      'agents.name as agent_name',
    ])
    .orderBy('eval_runs.created_at', 'desc')

  if (options?.agentId) {
    query = query.where('eval_runs.agent_id', '=', options.agentId)
  }
  if (options?.status) {
    query = query.where('eval_runs.status', '=', options.status)
  }
  if (options?.gatesPassed !== undefined) {
    query = query.where('eval_runs.gates_passed', '=', options.gatesPassed ? 1 : 0)
  }
  if (options?.cursor) {
    query = query.where((eb) =>
      eb.or([
        eb('eval_runs.created_at', '<', options.cursor!.createdAt),
        eb.and([
          eb('eval_runs.created_at', '=', options.cursor!.createdAt),
          eb('eval_runs.id', '<', options.cursor!.id),
        ]),
      ])
    )
  }
  query = query.limit(options?.limit ?? 50)

  return query.execute()
}

export async function getFleetEvalSummary(): Promise<{
  totalEvals: number
  avgOverallScore: number | null
  gatePassRate: number | null
  lastEvalAt: number | null
  evalCostTotal: number
}> {
  const db = getDb()

  const stats = await db
    .selectFrom('eval_runs')
    .select([
      sql<number>`count(*)`.as('total_evals'),
      sql<number>`avg(case when gates_passed = 1 then overall_score else null end)`.as(
        'avg_overall_score'
      ),
      sql<number>`sum(case when gates_passed = 1 then 1.0 else 0.0 end) / max(count(*), 1)`.as(
        'gate_pass_rate'
      ),
      sql<number>`max(created_at)`.as('last_eval_at'),
      sql<number>`coalesce(sum(total_cost_usd), 0)`.as('eval_cost_total'),
    ])
    .where('status', '=', 'completed')
    .executeTakeFirstOrThrow()

  return {
    totalEvals: stats.total_evals,
    avgOverallScore: stats.avg_overall_score,
    gatePassRate: stats.gate_pass_rate,
    lastEvalAt: stats.last_eval_at,
    evalCostTotal: stats.eval_cost_total,
  }
}

export async function getFleetScoreTrend(options?: { agentId?: string; days?: number }): Promise<
  Array<{
    date: string
    avg_score: number
    eval_count: number
  }>
> {
  const db = getDb()
  const days = options?.days ?? 30
  const sinceUnix = now() - days * 86400

  let query = db
    .selectFrom('eval_runs')
    .select([
      sql<string>`date(eval_runs.created_at, 'unixepoch')`.as('date'),
      sql<number>`avg(eval_runs.overall_score)`.as('avg_score'),
      sql<number>`count(*)`.as('eval_count'),
    ])
    .where('eval_runs.status', '=', 'completed')
    .where('eval_runs.gates_passed', '=', 1)
    .where('eval_runs.created_at', '>=', sinceUnix)

  if (options?.agentId) {
    query = query.where('eval_runs.agent_id', '=', options.agentId)
  }

  return query
    .groupBy(sql`date(eval_runs.created_at, 'unixepoch')`)
    .orderBy('date', 'asc')
    .execute()
}

export async function getPerAgentEvalStats(): Promise<
  Array<{
    agent_id: string
    agent_name: string
    total_evals: number
    avg_score: number | null
    gate_pass_rate: number | null
    last_eval_at: number | null
    eval_cost: number
  }>
> {
  const db = getDb()

  return db
    .selectFrom('eval_runs')
    .innerJoin('agents', 'agents.id', 'eval_runs.agent_id')
    .select([
      'eval_runs.agent_id',
      'agents.name as agent_name',
      sql<number>`count(*)`.as('total_evals'),
      sql<number>`avg(case when eval_runs.gates_passed = 1 then eval_runs.overall_score else null end)`.as(
        'avg_score'
      ),
      sql<number>`sum(case when eval_runs.gates_passed = 1 then 1.0 else 0.0 end) / max(count(*), 1)`.as(
        'gate_pass_rate'
      ),
      sql<number>`max(eval_runs.created_at)`.as('last_eval_at'),
      sql<number>`coalesce(sum(eval_runs.total_cost_usd), 0)`.as('eval_cost'),
    ])
    .where('eval_runs.status', '=', 'completed')
    .groupBy(['eval_runs.agent_id', 'agents.name'])
    .orderBy('agents.name', 'asc')
    .execute()
}

/** Count completed runs for an agent today (for sampling threshold check) */
export async function countCompletedRunsForAgentToday(agentId: string): Promise<number> {
  const db = getDb()
  const startOfDay = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000)
  const result = await db
    .selectFrom('run_dispatches')
    .select(sql<number>`count(*)`.as('count'))
    .where('agent_id', '=', agentId)
    .where('status', '=', 'completed')
    .where('finished_at', '>=', startOfDay)
    .executeTakeFirstOrThrow()
  return result.count
}
