import { getDb } from '../db'
import type { CostLimit, NewCostLimit, CostLimitUpdate } from '../types'
import { getAgentSpendInWindow, getTeamSpendInWindow, getOrgSpendInWindow } from './inference-calls'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

// ============================================================================
// CRUD
// ============================================================================

export async function findCostLimitById(id: string): Promise<CostLimit | null> {
  const db = getDb()
  const result = await db
    .selectFrom('cost_limits')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return result ?? null
}

export async function listCostLimitsForAgent(agentId: string): Promise<CostLimit[]> {
  const db = getDb()
  return db
    .selectFrom('cost_limits')
    .selectAll()
    .where('agent_id', '=', agentId)
    .where('scope', '=', 'agent')
    .orderBy('created_at', 'asc')
    .execute()
}

export async function listCostLimitsForTeam(teamId: string): Promise<CostLimit[]> {
  const db = getDb()
  return db
    .selectFrom('cost_limits')
    .selectAll()
    .where('team_id', '=', teamId)
    .where('scope', '=', 'team')
    .orderBy('created_at', 'asc')
    .execute()
}

export async function listCostLimitsForOrg(): Promise<CostLimit[]> {
  const db = getDb()
  return db
    .selectFrom('cost_limits')
    .selectAll()
    .where('scope', '=', 'org')
    .orderBy('created_at', 'asc')
    .execute()
}

export async function createCostLimit(
  data: Omit<NewCostLimit, 'id' | 'created_at' | 'updated_at'>
): Promise<CostLimit> {
  const db = getDb()
  const id = uuid()
  const timestamp = now()

  const result = await db
    .insertInto('cost_limits')
    .values({
      id,
      ...data,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return result
}

export async function updateCostLimit(
  id: string,
  data: Omit<CostLimitUpdate, 'id' | 'created_at'>
): Promise<CostLimit | null> {
  const db = getDb()
  const result = await db
    .updateTable('cost_limits')
    .set({ ...data, updated_at: now() })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
  return result ?? null
}

export async function deleteCostLimit(id: string): Promise<boolean> {
  const db = getDb()
  const result = await db.deleteFrom('cost_limits').where('id', '=', id).executeTakeFirst()
  return (result.numDeletedRows ?? 0n) > 0n
}

export async function listAllCostLimits(): Promise<
  Array<CostLimit & { agent_name: string | null; team_name: string | null }>
> {
  const db = getDb()
  return db
    .selectFrom('cost_limits')
    .leftJoin('agents', 'agents.id', 'cost_limits.agent_id')
    .leftJoin('teams', 'teams.id', 'cost_limits.team_id')
    .selectAll('cost_limits')
    .select('agents.name as agent_name')
    .select('teams.name as team_name')
    .orderBy('cost_limits.scope', 'asc')
    .orderBy('cost_limits.created_at', 'asc')
    .execute()
}

// ============================================================================
// Cost limit enforcement
// ============================================================================

/** Period start timestamp for the given period. */
function getPeriodStart(period: string): number {
  const timestamp = now()
  switch (period) {
    case 'hourly':
      return timestamp - 3600
    case 'daily':
      return timestamp - 86400
    case 'monthly':
      return timestamp - 30 * 86400
    default:
      return timestamp - 86400
  }
}

export interface CostLimitStatus {
  /** No limits breached */
  ok: boolean
  /** At soft limit — agent should be warned to wrap up */
  warned: boolean
  /** At hard limit — hard stop, break the inference loop */
  exceeded: boolean
  /** Human-readable details */
  details: string | null
}

/**
 * Check all enabled cost limits for an agent, cascading through
 * agent → team → org scopes. Returns the worst status across all levels.
 */
export async function checkLimits(agentId: string): Promise<CostLimitStatus> {
  const db = getDb()

  // 1. Check agent-level limits
  const agentLimits = await db
    .selectFrom('cost_limits')
    .selectAll()
    .where('agent_id', '=', agentId)
    .where('scope', '=', 'agent')
    .where('enabled', '=', 1)
    .execute()

  let worstStatus: CostLimitStatus = { ok: true, warned: false, exceeded: false, details: null }

  for (const limit of agentLimits) {
    const status = await evaluateLimit(
      limit,
      () => getAgentSpendInWindow(agentId, getPeriodStart(limit.period)),
      'agent'
    )
    worstStatus = worseStatus(worstStatus, status)
    if (worstStatus.exceeded) return worstStatus
  }

  // 2. Check team-level limits (look up agent's teams)
  const agentTeams = await db
    .selectFrom('agent_teams')
    .select('team_id')
    .where('agent_id', '=', agentId)
    .execute()

  for (const { team_id } of agentTeams) {
    const teamLimits = await db
      .selectFrom('cost_limits')
      .selectAll()
      .where('team_id', '=', team_id)
      .where('scope', '=', 'team')
      .where('enabled', '=', 1)
      .execute()

    for (const limit of teamLimits) {
      const status = await evaluateLimit(
        limit,
        () => getTeamSpendInWindow(team_id, getPeriodStart(limit.period)),
        'team'
      )
      worstStatus = worseStatus(worstStatus, status)
      if (worstStatus.exceeded) return worstStatus
    }
  }

  // 3. Check org-level limits
  const orgLimits = await db
    .selectFrom('cost_limits')
    .selectAll()
    .where('scope', '=', 'org')
    .where('enabled', '=', 1)
    .execute()

  for (const limit of orgLimits) {
    const status = await evaluateLimit(
      limit,
      () => getOrgSpendInWindow(getPeriodStart(limit.period)),
      'org'
    )
    worstStatus = worseStatus(worstStatus, status)
    if (worstStatus.exceeded) return worstStatus
  }

  return worstStatus
}

async function evaluateLimit(
  limit: CostLimit,
  getSpend: () => Promise<number>,
  scope: string
): Promise<CostLimitStatus> {
  const spent = await getSpend()
  const softThreshold = (limit.limit_usd * limit.soft_limit_pct) / 100
  const hardThreshold = (limit.limit_usd * limit.hard_limit_pct) / 100
  const ratio = spent / limit.limit_usd

  if (spent >= hardThreshold) {
    return {
      ok: false,
      warned: true,
      exceeded: true,
      details: `${scope} cost limit exceeded: spent $${spent.toFixed(4)} of $${limit.limit_usd.toFixed(2)} ${limit.period} budget (${Math.round(ratio * 100)}%, hard limit ${limit.hard_limit_pct}%)`,
    }
  }

  if (spent >= softThreshold) {
    return {
      ok: false,
      warned: true,
      exceeded: false,
      details: `${scope} cost warning: spent $${spent.toFixed(4)} of $${limit.limit_usd.toFixed(2)} ${limit.period} budget (${Math.round(ratio * 100)}%, soft limit ${limit.soft_limit_pct}%)`,
    }
  }

  return { ok: true, warned: false, exceeded: false, details: null }
}

function worseStatus(a: CostLimitStatus, b: CostLimitStatus): CostLimitStatus {
  if (b.exceeded) return b
  if (a.exceeded) return a
  if (b.warned) return b
  if (a.warned) return a
  return a
}
