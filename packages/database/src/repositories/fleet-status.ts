import { sql } from 'kysely'
import { getDb } from '../db'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface FleetRunCount {
  count: number
}

export interface FleetAvgDuration {
  avg_duration: number | null
}

export interface FleetPendingCount {
  count: number
}

export interface FleetRosterMetrics {
  agent_id: string
  run_count: number
  completed_count: number
  failed_count: number
  avg_score: number | null
  last_active_at: number | null
}

export interface FleetSparklineEntry {
  agent_id: string
  day: string
  run_count: number
}

export interface FleetActiveOperation {
  dispatch_id: string
  agent_id: string
  agent_name: string
  agent_config: string | null
  status: string
  title: string
  source: string
  started_at: number | null
  created_at: number
  lease_expires_at: number | null
}

export interface FleetZombieDispatch {
  dispatch_id: string
  agent_id: string
  agent_name: string
  lease_expires_at: number | null
  title: string
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

export async function getFleetRunCount(sinceUnix?: number): Promise<FleetRunCount> {
  const db = getDb()
  let query = db.selectFrom('jobs').select(sql<number>`count(*)`.as('count'))
  if (sinceUnix && sinceUnix > 0) query = query.where('created_at', '>=', sinceUnix)
  return query.executeTakeFirstOrThrow() as Promise<FleetRunCount>
}

export async function getFleetAvgDuration(sinceUnix?: number): Promise<FleetAvgDuration> {
  const db = getDb()
  let query = db
    .selectFrom('jobs')
    .select(sql<number | null>`avg(completed_at - started_at)`.as('avg_duration'))
    .where('completed_at', 'is not', null)
    .where('started_at', 'is not', null)
  if (sinceUnix && sinceUnix > 0) query = query.where('created_at', '>=', sinceUnix)
  return query.executeTakeFirstOrThrow() as Promise<FleetAvgDuration>
}

export async function getFleetPendingCount(): Promise<FleetPendingCount> {
  const db = getDb()
  return db
    .selectFrom('run_dispatches')
    .select(sql<number>`count(*)`.as('count'))
    .where('status', '=', 'queued')
    .executeTakeFirstOrThrow() as Promise<FleetPendingCount>
}

export async function getFleetRosterMetrics(sinceUnix?: number): Promise<FleetRosterMetrics[]> {
  const db = getDb()
  let query = db
    .selectFrom('jobs')
    .select([
      'agent_id',
      sql<number>`count(*)`.as('run_count'),
      sql<number>`sum(case when status = 'COMPLETED' then 1 else 0 end)`.as('completed_count'),
      sql<number>`sum(case when status = 'FAILED' then 1 else 0 end)`.as('failed_count'),
      sql<
        number | null
      >`case when count(*) > 0 then sum(case when status = 'COMPLETED' then 1 else 0 end) * 100.0 / count(*) else null end`.as(
        'avg_score'
      ),
      sql<number | null>`max(created_at)`.as('last_active_at'),
    ])
    .groupBy('agent_id')
  if (sinceUnix && sinceUnix > 0) query = query.where('created_at', '>=', sinceUnix)
  return query.execute() as Promise<FleetRosterMetrics[]>
}

export async function getFleetSparklineData(): Promise<FleetSparklineEntry[]> {
  const db = getDb()
  return db
    .selectFrom('jobs')
    .select([
      'agent_id',
      sql<string>`date(created_at, 'unixepoch')`.as('day'),
      sql<number>`count(*)`.as('run_count'),
    ])
    .where('created_at', '>=', now() - 7 * 86400)
    .groupBy(['agent_id', sql`date(created_at, 'unixepoch')`])
    .orderBy('agent_id')
    .orderBy(sql`date(created_at, 'unixepoch')`)
    .execute() as Promise<FleetSparklineEntry[]>
}

export async function getFleetActiveOperations(limit = 25): Promise<FleetActiveOperation[]> {
  const db = getDb()
  return db
    .selectFrom('run_dispatches')
    .innerJoin('work_items', 'work_items.id', 'run_dispatches.work_item_id')
    .innerJoin('agents', 'agents.id', 'run_dispatches.agent_id')
    .select([
      'run_dispatches.id as dispatch_id',
      'run_dispatches.agent_id',
      'agents.name as agent_name',
      'agents.config as agent_config',
      'run_dispatches.status',
      'work_items.title',
      'work_items.source',
      'run_dispatches.started_at',
      'run_dispatches.created_at',
      'run_dispatches.lease_expires_at',
    ])
    .where('run_dispatches.status', 'in', ['running', 'queued'])
    .orderBy('run_dispatches.created_at', 'desc')
    .limit(limit)
    .execute() as Promise<FleetActiveOperation[]>
}

export async function getFleetZombieDispatches(): Promise<FleetZombieDispatch[]> {
  const db = getDb()
  return db
    .selectFrom('run_dispatches')
    .innerJoin('work_items', 'work_items.id', 'run_dispatches.work_item_id')
    .innerJoin('agents', 'agents.id', 'run_dispatches.agent_id')
    .select([
      'run_dispatches.id as dispatch_id',
      'run_dispatches.agent_id',
      'agents.name as agent_name',
      'run_dispatches.lease_expires_at',
      'work_items.title',
    ])
    .where('run_dispatches.status', '=', 'running')
    .where('run_dispatches.lease_expires_at', '<', now())
    .execute() as Promise<FleetZombieDispatch[]>
}
