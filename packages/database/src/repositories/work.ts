import { sql, type Kysely } from 'kysely'
import { generateUuidV7 } from '@nitejar/core'
import { getDb } from '../db'
import type {
  Database,
  Goal,
  GoalAgentAllocation,
  GoalUpdate,
  Initiative,
  InitiativeUpdate,
  NewGoal,
  NewGoalAgentAllocation,
  NewInitiative,
  NewOrgUnit,
  NewTicket,
  NewTicketLink,
  NewTicketRelation,
  NewWorkView,
  NewWorkUpdate,
  OrgUnit,
  OrgUnitUpdate,
  Ticket,
  TicketLink,
  TicketRelation,
  TicketUpdate,
  WorkView,
  WorkViewUpdate,
  WorkItem,
  WorkUpdate,
} from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return generateUuidV7()
}

export const WORK_TICKET_STALE_AFTER_SECONDS = 48 * 60 * 60
export const WORK_GOAL_ACTIVITY_STALE_AFTER_SECONDS = 72 * 60 * 60
export const WORK_GOAL_HEARTBEAT_STALE_AFTER_SECONDS = 7 * 24 * 60 * 60

export interface ListOrgUnitsOptions {
  parentOrgUnitId?: string | null
  kinds?: string[]
  includeChildren?: boolean
}

export async function createOrgUnit(
  data: Omit<NewOrgUnit, 'id' | 'created_at' | 'updated_at'>,
  trx?: Kysely<Database>
): Promise<OrgUnit> {
  const db = trx ?? getDb()
  const timestamp = now()
  return db
    .insertInto('org_units')
    .values({
      id: uuid(),
      ...data,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function updateOrgUnit(
  id: string,
  data: Omit<OrgUnitUpdate, 'id' | 'created_at'>,
  trx?: Kysely<Database>
): Promise<OrgUnit | null> {
  const db = trx ?? getDb()
  const row = await db
    .updateTable('org_units')
    .set({
      ...data,
      updated_at: now(),
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()

  return row ?? null
}

export async function findOrgUnitById(id: string): Promise<OrgUnit | null> {
  const db = getDb()
  const row = await db.selectFrom('org_units').selectAll().where('id', '=', id).executeTakeFirst()
  return row ?? null
}

export async function listOrgUnits(opts: ListOrgUnitsOptions = {}): Promise<OrgUnit[]> {
  const db = getDb()
  let query = db.selectFrom('org_units').selectAll()

  if (opts.parentOrgUnitId === null) {
    query = query.where('parent_org_unit_id', 'is', null)
  } else if (opts.parentOrgUnitId) {
    query = query.where('parent_org_unit_id', '=', opts.parentOrgUnitId)
  }

  if (opts.kinds && opts.kinds.length > 0) {
    query = query.where('kind', 'in', opts.kinds)
  }

  return query.orderBy('sort_order', 'asc').orderBy('name', 'asc').execute()
}

export interface ListInitiativesOptions {
  parentInitiativeId?: string | null
  statuses?: string[]
  ownerKind?: string
  ownerRef?: string
  teamId?: string
  q?: string
  includeArchived?: boolean
  limit?: number
  sortBy?: 'updated_at' | 'created_at' | 'title' | 'status'
  sortDirection?: 'asc' | 'desc'
}

export async function createInitiative(
  data: Omit<NewInitiative, 'id' | 'created_at' | 'updated_at'>,
  trx?: Kysely<Database>
): Promise<Initiative> {
  const db = trx ?? getDb()
  const timestamp = now()
  return db
    .insertInto('initiatives')
    .values({
      id: uuid(),
      ...data,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function updateInitiative(
  id: string,
  data: Omit<InitiativeUpdate, 'id' | 'created_at'>,
  trx?: Kysely<Database>
): Promise<Initiative | null> {
  const db = trx ?? getDb()
  const row = await db
    .updateTable('initiatives')
    .set({
      ...data,
      updated_at: now(),
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()

  return row ?? null
}

export async function findInitiativeById(id: string): Promise<Initiative | null> {
  const db = getDb()
  const row = await db.selectFrom('initiatives').selectAll().where('id', '=', id).executeTakeFirst()
  return row ?? null
}

export async function listInitiatives(opts: ListInitiativesOptions = {}): Promise<Initiative[]> {
  const db = getDb()
  let query = db.selectFrom('initiatives').selectAll()

  if (opts.parentInitiativeId === null) {
    query = query.where('parent_initiative_id', 'is', null)
  } else if (opts.parentInitiativeId) {
    query = query.where('parent_initiative_id', '=', opts.parentInitiativeId)
  }

  if (opts.statuses && opts.statuses.length > 0) {
    query = query.where('status', 'in', opts.statuses)
  }

  if (opts.ownerKind) {
    query = query.where('owner_kind', '=', opts.ownerKind)
  }

  if (opts.ownerRef) {
    query = query.where('owner_ref', '=', opts.ownerRef)
  }

  if (opts.teamId) {
    query = query.where('team_id', '=', opts.teamId)
  }

  if (!opts.includeArchived) {
    query = query.where('archived_at', 'is', null)
  }

  const q = opts.q?.trim()
  if (q) {
    const like = `%${q.toLowerCase()}%`
    query = query.where((eb) =>
      eb.or([
        sql<boolean>`lower(initiatives.title) like ${like}`,
        sql<boolean>`lower(coalesce(initiatives.description, '')) like ${like}`,
      ])
    )
  }

  const sortDirection = opts.sortDirection === 'asc' ? 'asc' : 'desc'
  const sortBy = opts.sortBy ?? 'updated_at'
  if (sortBy === 'title' || sortBy === 'status') {
    query = query.orderBy(sortBy, sortDirection).orderBy('updated_at', 'desc')
  } else {
    query = query.orderBy(sortBy, sortDirection).orderBy('created_at', 'desc')
  }

  if (opts.limit) {
    query = query.limit(Math.min(Math.max(opts.limit, 1), 200))
  }

  return query.execute()
}

export interface ListGoalsOptions {
  initiativeId?: string
  parentGoalId?: string | null
  statuses?: string[]
  ownerKind?: string
  ownerRef?: string
  teamId?: string
  q?: string
  includeArchived?: boolean
  limit?: number
  sortBy?: 'updated_at' | 'created_at' | 'title' | 'status'
  sortDirection?: 'asc' | 'desc'
}

export async function createGoal(
  data: Omit<NewGoal, 'id' | 'created_at' | 'updated_at'>,
  trx?: Kysely<Database>
): Promise<Goal> {
  const db = trx ?? getDb()
  const timestamp = now()
  return db
    .insertInto('goals')
    .values({
      id: uuid(),
      ...data,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function updateGoal(
  id: string,
  data: Omit<GoalUpdate, 'id' | 'created_at'>,
  trx?: Kysely<Database>
): Promise<Goal | null> {
  const db = trx ?? getDb()
  const row = await db
    .updateTable('goals')
    .set({
      ...data,
      updated_at: now(),
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()

  return row ?? null
}

export async function findGoalById(id: string): Promise<Goal | null> {
  const db = getDb()
  const row = await db.selectFrom('goals').selectAll().where('id', '=', id).executeTakeFirst()
  return row ?? null
}

export async function upsertGoalAgentAllocation(
  data: Omit<NewGoalAgentAllocation, 'created_at'>,
  trx?: Kysely<Database>
): Promise<GoalAgentAllocation> {
  const db = trx ?? getDb()
  const inserted = await db
    .insertInto('goal_agent_allocations')
    .values({
      ...data,
      created_at: now(),
    })
    .onConflict((oc) => oc.columns(['goal_id', 'agent_id']).doNothing())
    .returningAll()
    .executeTakeFirst()

  if (inserted) return inserted

  return db
    .selectFrom('goal_agent_allocations')
    .selectAll()
    .where('goal_id', '=', data.goal_id)
    .where('agent_id', '=', data.agent_id)
    .executeTakeFirstOrThrow()
}

export async function deleteGoalAgentAllocation(
  goalId: string,
  agentId: string,
  trx?: Kysely<Database>
): Promise<boolean> {
  const db = trx ?? getDb()
  const result = await db
    .deleteFrom('goal_agent_allocations')
    .where('goal_id', '=', goalId)
    .where('agent_id', '=', agentId)
    .executeTakeFirst()

  return Number(result.numDeletedRows ?? 0) > 0
}

export async function listGoalAgentAllocations(opts?: {
  goalIds?: string[]
  agentIds?: string[]
}): Promise<GoalAgentAllocation[]> {
  const db = getDb()
  let query = db.selectFrom('goal_agent_allocations').selectAll()

  if (opts?.goalIds && opts.goalIds.length > 0) {
    query = query.where('goal_id', 'in', opts.goalIds)
  }

  if (opts?.agentIds && opts.agentIds.length > 0) {
    query = query.where('agent_id', 'in', opts.agentIds)
  }

  return query.orderBy('created_at', 'asc').execute()
}

export async function listGoals(opts: ListGoalsOptions = {}): Promise<Goal[]> {
  const db = getDb()
  let query = db.selectFrom('goals').selectAll()

  if (opts.initiativeId) {
    query = query.where('initiative_id', '=', opts.initiativeId)
  }

  if (opts.parentGoalId === null) {
    query = query.where('parent_goal_id', 'is', null)
  } else if (opts.parentGoalId) {
    query = query.where('parent_goal_id', '=', opts.parentGoalId)
  }

  if (opts.statuses && opts.statuses.length > 0) {
    query = query.where('status', 'in', opts.statuses)
  }

  if (opts.ownerKind) {
    query = query.where('owner_kind', '=', opts.ownerKind)
  }

  if (opts.ownerRef) {
    query = query.where('owner_ref', '=', opts.ownerRef)
  }

  if (opts.teamId) {
    query = query.where('team_id', '=', opts.teamId)
  }

  if (!opts.includeArchived) {
    query = query.where('archived_at', 'is', null)
  }

  const q = opts.q?.trim()
  if (q) {
    const like = `%${q.toLowerCase()}%`
    query = query.where((eb) =>
      eb.or([
        sql<boolean>`lower(goals.title) like ${like}`,
        sql<boolean>`lower(goals.outcome) like ${like}`,
      ])
    )
  }

  const sortDirection = opts.sortDirection === 'asc' ? 'asc' : 'desc'
  const sortBy = opts.sortBy ?? 'updated_at'
  if (sortBy === 'title' || sortBy === 'status') {
    query = query.orderBy(sortBy, sortDirection).orderBy('updated_at', 'desc')
  } else {
    query = query.orderBy(sortBy, sortDirection).orderBy('created_at', 'desc')
  }

  if (opts.limit) {
    query = query.limit(Math.min(Math.max(opts.limit, 1), 200))
  }

  return query.execute()
}

export interface ListTicketsOptions {
  goalId?: string | null
  parentTicketId?: string | null
  statuses?: string[]
  assigneeKind?: string
  assigneeRef?: string
  assigneeRefs?: string[]
  q?: string
  includeArchived?: boolean
  limit?: number
  staleBefore?: number
  sortBy?: 'updated_at' | 'created_at' | 'title' | 'status'
  sortDirection?: 'asc' | 'desc'
}

export async function createTicket(
  data: Omit<NewTicket, 'id' | 'created_at' | 'updated_at'>,
  trx?: Kysely<Database>
): Promise<Ticket> {
  const db = trx ?? getDb()
  const timestamp = now()
  return db
    .insertInto('tickets')
    .values({
      id: uuid(),
      ...data,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function updateTicket(
  id: string,
  data: Omit<TicketUpdate, 'id' | 'created_at'>,
  trx?: Kysely<Database>
): Promise<Ticket | null> {
  const db = trx ?? getDb()
  const row = await db
    .updateTable('tickets')
    .set({
      ...data,
      updated_at: now(),
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()

  return row ?? null
}

export async function claimTicket(
  id: string,
  input: {
    assigneeKind: 'user' | 'agent'
    assigneeRef: string
    claimedByKind?: 'user' | 'agent' | 'system'
    claimedByRef?: string | null
  },
  trx?: Kysely<Database>
): Promise<Ticket | null> {
  const db = trx ?? getDb()
  const timestamp = now()
  const row = await db
    .updateTable('tickets')
    .set({
      assignee_kind: input.assigneeKind,
      assignee_ref: input.assigneeRef,
      claimed_by_kind: input.claimedByKind ?? input.assigneeKind,
      claimed_by_ref: input.claimedByRef ?? input.assigneeRef,
      claimed_at: timestamp,
      status: 'in_progress',
      updated_at: timestamp,
    })
    .where('id', '=', id)
    .where('archived_at', 'is', null)
    .returningAll()
    .executeTakeFirst()

  return row ?? null
}

export async function findTicketById(id: string): Promise<Ticket | null> {
  const db = getDb()
  const row = await db.selectFrom('tickets').selectAll().where('id', '=', id).executeTakeFirst()
  return row ?? null
}

export async function listTickets(opts: ListTicketsOptions = {}): Promise<Ticket[]> {
  const db = getDb()
  let query = db.selectFrom('tickets').selectAll()

  if (opts.goalId === null) {
    query = query.where('goal_id', 'is', null)
  } else if (opts.goalId) {
    query = query.where('goal_id', '=', opts.goalId)
  }

  if (opts.parentTicketId === null) {
    query = query.where('parent_ticket_id', 'is', null)
  } else if (opts.parentTicketId) {
    query = query.where('parent_ticket_id', '=', opts.parentTicketId)
  }

  if (opts.statuses && opts.statuses.length > 0) {
    query = query.where('status', 'in', opts.statuses)
  }

  if (opts.assigneeKind) {
    query = query.where('assignee_kind', '=', opts.assigneeKind)
  }

  if (opts.assigneeRef) {
    query = query.where('assignee_ref', '=', opts.assigneeRef)
  }

  if (opts.assigneeRefs && opts.assigneeRefs.length > 0) {
    query = query.where('assignee_ref', 'in', opts.assigneeRefs)
  }

  if (!opts.includeArchived) {
    query = query.where('archived_at', 'is', null)
  }

  if (typeof opts.staleBefore === 'number') {
    query = query.where('updated_at', '<=', opts.staleBefore)
  }

  const q = opts.q?.trim()
  if (q) {
    const like = `%${q.toLowerCase()}%`
    query = query.where((eb) =>
      eb.or([
        sql<boolean>`lower(tickets.title) like ${like}`,
        sql<boolean>`lower(coalesce(tickets.body, '')) like ${like}`,
        eb('tickets.id', '=', q),
      ])
    )
  }

  const sortDirection = opts.sortDirection === 'asc' ? 'asc' : 'desc'
  const sortBy = opts.sortBy ?? 'updated_at'
  if (sortBy === 'title' || sortBy === 'status') {
    query = query.orderBy(sortBy, sortDirection).orderBy('updated_at', 'desc')
  } else {
    query = query.orderBy(sortBy, sortDirection).orderBy('created_at', 'desc')
  }

  if (opts.limit) {
    query = query.limit(Math.min(Math.max(opts.limit, 1), 200))
  }

  return query.execute()
}

export async function createTicketRelation(
  data: Omit<NewTicketRelation, 'id' | 'created_at'>,
  trx?: Kysely<Database>
): Promise<TicketRelation> {
  const db = trx ?? getDb()
  return db
    .insertInto('ticket_relations')
    .values({
      id: uuid(),
      ...data,
      created_at: now(),
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function listTicketRelations(opts?: {
  ticketIds?: string[]
  relatedTicketIds?: string[]
  kinds?: string[]
}): Promise<TicketRelation[]> {
  const db = getDb()
  let query = db.selectFrom('ticket_relations').selectAll()

  if (opts?.ticketIds?.length && opts?.relatedTicketIds?.length) {
    query = query.where((eb) =>
      eb.or([
        eb('ticket_id', 'in', opts.ticketIds!),
        eb('related_ticket_id', 'in', opts.relatedTicketIds!),
      ])
    )
  } else if (opts?.ticketIds && opts.ticketIds.length > 0) {
    query = query.where('ticket_id', 'in', opts.ticketIds)
  } else if (opts?.relatedTicketIds && opts.relatedTicketIds.length > 0) {
    query = query.where('related_ticket_id', 'in', opts.relatedTicketIds)
  }

  if (opts?.kinds && opts.kinds.length > 0) {
    query = query.where('kind', 'in', opts.kinds)
  }

  return query.orderBy('created_at', 'desc').execute()
}

export async function createWorkUpdate(
  data: Omit<NewWorkUpdate, 'id' | 'created_at'>,
  trx?: Kysely<Database>
): Promise<WorkUpdate> {
  const db = trx ?? getDb()
  return db
    .insertInto('work_updates')
    .values({
      id: uuid(),
      ...data,
      created_at: now(),
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function listWorkUpdates(opts: {
  goalId?: string
  ticketId?: string
  teamId?: string
  kinds?: string[]
  limit?: number
}): Promise<WorkUpdate[]> {
  const db = getDb()
  let query = db.selectFrom('work_updates').selectAll()

  if (opts.goalId) {
    query = query.where('goal_id', '=', opts.goalId)
  }
  if (opts.ticketId) {
    query = query.where('ticket_id', '=', opts.ticketId)
  }
  if (opts.teamId) {
    query = query.where('team_id', '=', opts.teamId)
  }
  if (opts.kinds && opts.kinds.length > 0) {
    query = query.where('kind', 'in', opts.kinds)
  }

  query = query.orderBy('created_at', 'desc')

  if (opts.limit) {
    query = query.limit(Math.min(Math.max(opts.limit, 1), 200))
  }

  return query.execute()
}

export async function createTicketLink(
  data: Omit<NewTicketLink, 'id' | 'created_at'>,
  trx?: Kysely<Database>
): Promise<TicketLink> {
  const db = trx ?? getDb()
  const record = {
    id: uuid(),
    ...data,
    created_at: now(),
  }

  await db
    .insertInto('ticket_links')
    .values(record)
    .onConflict((oc) => oc.columns(['ticket_id', 'kind', 'ref']).doNothing())
    .execute()

  const row = await db
    .selectFrom('ticket_links')
    .selectAll()
    .where('ticket_id', '=', data.ticket_id)
    .where('kind', '=', data.kind)
    .where('ref', '=', data.ref)
    .executeTakeFirst()

  if (!row) {
    throw new Error('Ticket link insert failed.')
  }

  return row
}

export async function listTicketLinksByTicket(ticketId: string): Promise<TicketLink[]> {
  const db = getDb()
  return db
    .selectFrom('ticket_links')
    .selectAll()
    .where('ticket_id', '=', ticketId)
    .orderBy('created_at', 'desc')
    .execute()
}

export async function findTicketByLink(kind: string, ref: string): Promise<Ticket | null> {
  const db = getDb()
  const row = await db
    .selectFrom('ticket_links')
    .innerJoin('tickets', 'tickets.id', 'ticket_links.ticket_id')
    .selectAll('tickets')
    .where('ticket_links.kind', '=', kind)
    .where('ticket_links.ref', '=', ref)
    .orderBy('ticket_links.created_at', 'desc')
    .executeTakeFirst()

  return row ?? null
}

export async function findTicketBySessionKey(sessionKey: string): Promise<Ticket | null> {
  return findTicketByLink('session', sessionKey)
}

export async function findTicketByWorkItemId(workItemId: string): Promise<Ticket | null> {
  return findTicketByLink('work_item', workItemId)
}

export async function listLinkedWorkItemsForTicket(ticketId: string): Promise<WorkItem[]> {
  const db = getDb()
  const links = await listTicketLinksByTicket(ticketId)
  const directWorkItemIds = links
    .filter((link) => link.kind === 'work_item')
    .map((link) => link.ref)
  const sessionKeys = links.filter((link) => link.kind === 'session').map((link) => link.ref)

  const workItems: WorkItem[] = []
  const seen = new Set<string>()

  if (directWorkItemIds.length > 0) {
    const direct = await db
      .selectFrom('work_items')
      .selectAll()
      .where('id', 'in', directWorkItemIds)
      .orderBy('created_at', 'desc')
      .execute()
    for (const item of direct) {
      workItems.push(item)
      seen.add(item.id)
    }
  }

  if (sessionKeys.length > 0) {
    const viaSessions = await db
      .selectFrom('work_items')
      .selectAll()
      .where('session_key', 'in', sessionKeys)
      .orderBy('created_at', 'desc')
      .execute()
    for (const item of viaSessions) {
      if (seen.has(item.id)) continue
      workItems.push(item)
      seen.add(item.id)
    }
  }

  return workItems.sort((a, b) => b.created_at - a.created_at)
}

export async function createWorkView(
  data: Omit<NewWorkView, 'id' | 'created_at' | 'updated_at'>,
  trx?: Kysely<Database>
): Promise<WorkView> {
  const db = trx ?? getDb()
  const timestamp = now()
  return db
    .insertInto('work_views')
    .values({
      id: uuid(),
      ...data,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function updateWorkView(
  id: string,
  data: Omit<WorkViewUpdate, 'id' | 'created_at'>,
  trx?: Kysely<Database>
): Promise<WorkView | null> {
  const db = trx ?? getDb()
  const row = await db
    .updateTable('work_views')
    .set({
      ...data,
      updated_at: now(),
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()

  return row ?? null
}

export async function findWorkViewById(id: string): Promise<WorkView | null> {
  const db = getDb()
  const row = await db.selectFrom('work_views').selectAll().where('id', '=', id).executeTakeFirst()
  return row ?? null
}

export async function deleteWorkView(id: string, ownerUserId?: string): Promise<boolean> {
  const db = getDb()
  let query = db.deleteFrom('work_views').where('id', '=', id)
  if (ownerUserId) {
    query = query.where('owner_user_id', '=', ownerUserId)
  }
  const result = await query.executeTakeFirst()
  return Number(result.numDeletedRows ?? 0) > 0
}

export async function listWorkViews(opts: {
  ownerUserId: string
  entityKind?: string
  scope?: string
  limit?: number
}): Promise<WorkView[]> {
  const db = getDb()
  let query = db
    .selectFrom('work_views')
    .selectAll()
    .where('owner_user_id', '=', opts.ownerUserId)
    .orderBy('updated_at', 'desc')
    .orderBy('created_at', 'desc')

  if (opts.entityKind) {
    query = query.where('entity_kind', '=', opts.entityKind)
  }

  if (opts.scope) {
    query = query.where('scope', '=', opts.scope)
  }

  if (opts.limit) {
    query = query.limit(Math.min(Math.max(opts.limit, 1), 200))
  }

  return query.execute()
}

function normalizeTextForSimilarity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildSimilarityTokens(value: string): string[] {
  return normalizeTextForSimilarity(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
}

export async function listRelatedTickets(input: {
  text: string
  excludeTicketId?: string
  limit?: number
  statuses?: string[]
}): Promise<Array<{ ticket: Ticket; score: number }>> {
  const source = input.text.trim()
  if (!source) return []

  const candidates = await listTickets({
    statuses: input.statuses ?? ['inbox', 'ready', 'in_progress', 'blocked'],
    limit: 200,
  })

  const sourceNormalized = normalizeTextForSimilarity(source)
  const sourceTokens = buildSimilarityTokens(source)
  const sourceTokenSet = new Set(sourceTokens)

  return candidates
    .filter((ticket) => ticket.id !== input.excludeTicketId)
    .map((ticket) => {
      const haystack = normalizeTextForSimilarity(`${ticket.title} ${ticket.body ?? ''}`)
      if (!haystack) return { ticket, score: 0 }
      let score = 0
      if (haystack.includes(sourceNormalized) || sourceNormalized.includes(haystack)) {
        score += 6
      }
      for (const token of buildSimilarityTokens(`${ticket.title} ${ticket.body ?? ''}`)) {
        if (sourceTokenSet.has(token)) {
          score += 1
        }
      }
      return { ticket, score }
    })
    .filter((entry) => entry.score >= 2)
    .sort((a, b) => b.score - a.score || b.ticket.updated_at - a.ticket.updated_at)
    .slice(0, Math.min(Math.max(input.limit ?? 5, 1), 20))
}

export async function listUntrackedAppSessions(opts?: {
  ownerUserId?: string
  limit?: number
}): Promise<
  Array<{
    session_key: string
    title: string | null
    primary_agent_id: string
    last_activity_at: number
    latest_work_title: string | null
  }>
> {
  const db = getDb()
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100)

  let sessionQuery = db
    .selectFrom('app_sessions')
    .select(['session_key', 'title', 'primary_agent_id', 'last_activity_at'])
    .orderBy('last_activity_at', 'desc')
    .limit(limit * 3)

  if (opts?.ownerUserId) {
    sessionQuery = sessionQuery.where('owner_user_id', '=', opts.ownerUserId)
  }

  const sessions = await sessionQuery.execute()
  if (sessions.length === 0) return []

  const sessionKeys = sessions.map((session) => session.session_key)
  const linkedRows = await db
    .selectFrom('ticket_links')
    .select(['ref'])
    .where('kind', '=', 'session')
    .where('ref', 'in', sessionKeys)
    .execute()
  const linked = new Set(linkedRows.map((row) => row.ref))

  const latestRows = await db
    .selectFrom('work_items')
    .select(['session_key', 'title', 'created_at'])
    .where('session_key', 'in', sessionKeys)
    .orderBy('created_at', 'desc')
    .execute()

  const latestTitleBySession = new Map<string, string>()
  for (const row of latestRows) {
    if (!latestTitleBySession.has(row.session_key)) {
      latestTitleBySession.set(row.session_key, row.title)
    }
  }

  return sessions
    .filter((session) => !linked.has(session.session_key))
    .slice(0, limit)
    .map((session) => ({
      ...session,
      latest_work_title: latestTitleBySession.get(session.session_key) ?? null,
    }))
}

export interface TicketWorkloadRollup {
  assignee_kind: string | null
  assignee_ref: string | null
  open_count: number
  inbox_count: number
  ready_count: number
  in_progress_count: number
  blocked_count: number
  done_count: number
  last_updated_at: number | null
  oldest_updated_at: number | null
}

export async function listTicketWorkloadRollups(opts?: {
  statuses?: string[]
  limit?: number
}): Promise<TicketWorkloadRollup[]> {
  const db = getDb()
  let query = db
    .selectFrom('tickets')
    .select([
      'assignee_kind',
      'assignee_ref',
      sql<number>`count(*)`.as('open_count'),
      sql<number>`sum(case when status = 'inbox' then 1 else 0 end)`.as('inbox_count'),
      sql<number>`sum(case when status = 'ready' then 1 else 0 end)`.as('ready_count'),
      sql<number>`sum(case when status = 'in_progress' then 1 else 0 end)`.as('in_progress_count'),
      sql<number>`sum(case when status = 'blocked' then 1 else 0 end)`.as('blocked_count'),
      sql<number>`sum(case when status = 'done' then 1 else 0 end)`.as('done_count'),
      sql<number | null>`max(updated_at)`.as('last_updated_at'),
      sql<number | null>`min(updated_at)`.as('oldest_updated_at'),
    ])
    .where('archived_at', 'is', null)
    .groupBy(['assignee_kind', 'assignee_ref'])
    .orderBy(sql`count(*)`, 'desc')

  if (opts?.statuses && opts.statuses.length > 0) {
    query = query.where('status', 'in', opts.statuses)
  }

  if (opts?.limit) {
    query = query.limit(Math.min(Math.max(opts.limit, 1), 200))
  }

  return query.execute() as Promise<TicketWorkloadRollup[]>
}

export interface GoalHealthSummary {
  goal_id: string
  total_ticket_count: number
  open_ticket_count: number
  inbox_count: number
  ready_count: number
  in_progress_count: number
  blocked_count: number
  done_count: number
  last_activity_at: number
  last_heartbeat_at: number | null
  is_stale: boolean
  health: 'draft' | 'active' | 'at_risk' | 'blocked' | 'done' | 'archived'
}

export async function listGoalHealthSummaries(opts?: {
  goalIds?: string[]
  activityStaleAfterSeconds?: number
  heartbeatStaleAfterSeconds?: number
}): Promise<GoalHealthSummary[]> {
  const db = getDb()
  const activityStaleAfterSeconds =
    opts?.activityStaleAfterSeconds ?? WORK_GOAL_ACTIVITY_STALE_AFTER_SECONDS
  const heartbeatStaleAfterSeconds =
    opts?.heartbeatStaleAfterSeconds ?? WORK_GOAL_HEARTBEAT_STALE_AFTER_SECONDS

  let goalsQuery = db
    .selectFrom('goals')
    .select(['id', 'status', 'updated_at'])
    .where('archived_at', 'is', null)

  if (opts?.goalIds && opts.goalIds.length > 0) {
    goalsQuery = goalsQuery.where('id', 'in', opts.goalIds)
  }

  const goals = await goalsQuery.execute()
  if (goals.length === 0) return []

  const goalIds = goals.map((goal) => goal.id)
  const [tickets, updates] = await Promise.all([
    db
      .selectFrom('tickets')
      .select(['goal_id', 'status', 'updated_at'])
      .where('goal_id', 'in', goalIds)
      .where('archived_at', 'is', null)
      .execute(),
    db
      .selectFrom('work_updates')
      .select(['goal_id', 'kind', 'created_at'])
      .where('goal_id', 'in', goalIds)
      .execute(),
  ])

  const ticketCounts = new Map<
    string,
    {
      total: number
      open: number
      inbox: number
      ready: number
      inProgress: number
      blocked: number
      done: number
    }
  >()
  const lastUpdateByGoal = new Map<string, number>()
  const lastHeartbeatByGoal = new Map<string, number>()

  for (const ticket of tickets) {
    if (!ticket.goal_id) continue
    const current = ticketCounts.get(ticket.goal_id) ?? {
      total: 0,
      open: 0,
      inbox: 0,
      ready: 0,
      inProgress: 0,
      blocked: 0,
      done: 0,
    }
    current.total += 1
    if (ticket.status !== 'done' && ticket.status !== 'canceled') current.open += 1
    if (ticket.status === 'inbox') current.inbox += 1
    if (ticket.status === 'ready') current.ready += 1
    if (ticket.status === 'in_progress') current.inProgress += 1
    if (ticket.status === 'blocked') current.blocked += 1
    if (ticket.status === 'done') current.done += 1
    ticketCounts.set(ticket.goal_id, current)
    lastUpdateByGoal.set(
      ticket.goal_id,
      Math.max(lastUpdateByGoal.get(ticket.goal_id) ?? 0, ticket.updated_at)
    )
  }

  for (const update of updates) {
    if (!update.goal_id) continue
    lastUpdateByGoal.set(
      update.goal_id,
      Math.max(lastUpdateByGoal.get(update.goal_id) ?? 0, update.created_at)
    )
    if (update.kind === 'heartbeat') {
      lastHeartbeatByGoal.set(
        update.goal_id,
        Math.max(lastHeartbeatByGoal.get(update.goal_id) ?? 0, update.created_at)
      )
    }
  }

  const nowTs = now()
  const activityStaleBefore = nowTs - activityStaleAfterSeconds
  const heartbeatStaleBefore = nowTs - heartbeatStaleAfterSeconds

  return goals.map((goal) => {
    const counts = ticketCounts.get(goal.id) ?? {
      total: 0,
      open: 0,
      inbox: 0,
      ready: 0,
      inProgress: 0,
      blocked: 0,
      done: 0,
    }
    const lastActivityAt = Math.max(lastUpdateByGoal.get(goal.id) ?? 0, goal.updated_at)
    const lastHeartbeatAt = lastHeartbeatByGoal.get(goal.id) ?? null
    const isStale = lastHeartbeatAt
      ? lastHeartbeatAt <= heartbeatStaleBefore
      : lastActivityAt <= activityStaleBefore

    let health: GoalHealthSummary['health']
    if (
      goal.status === 'draft' ||
      goal.status === 'blocked' ||
      goal.status === 'at_risk' ||
      goal.status === 'done' ||
      goal.status === 'archived'
    ) {
      health = goal.status
    } else if (counts.blocked > 0) {
      health = 'blocked'
    } else if (isStale || (counts.open > 0 && counts.inProgress === 0 && counts.ready === 0)) {
      health = 'at_risk'
    } else {
      health = 'active'
    }

    return {
      goal_id: goal.id,
      total_ticket_count: counts.total,
      open_ticket_count: counts.open,
      inbox_count: counts.inbox,
      ready_count: counts.ready,
      in_progress_count: counts.inProgress,
      blocked_count: counts.blocked,
      done_count: counts.done,
      last_activity_at: lastActivityAt,
      last_heartbeat_at: lastHeartbeatAt,
      is_stale: isStale,
      health,
    }
  })
}

export interface AgentWorkloadRollup {
  agent_id: string
  open_ticket_count: number
  blocked_ticket_count: number
  in_progress_ticket_count: number
  ready_ticket_count: number
  recent_done_ticket_count: number
  owned_goal_count: number
  open_goal_count: number
  last_ticket_activity_at: number | null
}

export async function listAgentWorkloadRollups(opts?: {
  agentIds?: string[]
  recentDoneSince?: number
}): Promise<AgentWorkloadRollup[]> {
  const db = getDb()
  const recentDoneSince = opts?.recentDoneSince ?? now() - 7 * 24 * 60 * 60
  const agentIds = opts?.agentIds ?? null

  let openTicketsQuery = db
    .selectFrom('tickets')
    .select([
      'assignee_ref as agent_id',
      sql<number>`count(*)`.as('open_ticket_count'),
      sql<number>`sum(case when status = 'blocked' then 1 else 0 end)`.as('blocked_ticket_count'),
      sql<number>`sum(case when status = 'in_progress' then 1 else 0 end)`.as(
        'in_progress_ticket_count'
      ),
      sql<number>`sum(case when status = 'ready' then 1 else 0 end)`.as('ready_ticket_count'),
      sql<number | null>`max(updated_at)`.as('last_ticket_activity_at'),
    ])
    .where('archived_at', 'is', null)
    .where('assignee_kind', '=', 'agent')
    .where('status', 'in', ['ready', 'in_progress', 'blocked'])
    .where('assignee_ref', 'is not', null)
    .groupBy('assignee_ref')

  let recentDoneQuery = db
    .selectFrom('tickets')
    .select(['assignee_ref as agent_id', sql<number>`count(*)`.as('recent_done_ticket_count')])
    .where('archived_at', 'is', null)
    .where('assignee_kind', '=', 'agent')
    .where('status', '=', 'done')
    .where('updated_at', '>=', recentDoneSince)
    .where('assignee_ref', 'is not', null)
    .groupBy('assignee_ref')

  let goalsQuery = db
    .selectFrom('goals')
    .select([
      'owner_ref as agent_id',
      sql<number>`count(*)`.as('owned_goal_count'),
      sql<number>`sum(case when status not in ('done', 'archived') then 1 else 0 end)`.as(
        'open_goal_count'
      ),
    ])
    .where('archived_at', 'is', null)
    .where('owner_kind', '=', 'agent')
    .where('owner_ref', 'is not', null)
    .groupBy('owner_ref')

  if (agentIds && agentIds.length > 0) {
    openTicketsQuery = openTicketsQuery.where('assignee_ref', 'in', agentIds)
    recentDoneQuery = recentDoneQuery.where('assignee_ref', 'in', agentIds)
    goalsQuery = goalsQuery.where('owner_ref', 'in', agentIds)
  }

  const [openTicketRows, recentDoneRows, goalRows] = await Promise.all([
    openTicketsQuery.execute(),
    recentDoneQuery.execute(),
    goalsQuery.execute(),
  ])

  const rollups = new Map<string, AgentWorkloadRollup>()

  for (const row of openTicketRows) {
    if (!row.agent_id) continue
    rollups.set(row.agent_id, {
      agent_id: row.agent_id,
      open_ticket_count: row.open_ticket_count,
      blocked_ticket_count: row.blocked_ticket_count,
      in_progress_ticket_count: row.in_progress_ticket_count,
      ready_ticket_count: row.ready_ticket_count,
      recent_done_ticket_count: 0,
      owned_goal_count: 0,
      open_goal_count: 0,
      last_ticket_activity_at: row.last_ticket_activity_at,
    })
  }

  for (const row of recentDoneRows) {
    if (!row.agent_id) continue
    const current = rollups.get(row.agent_id) ?? {
      agent_id: row.agent_id,
      open_ticket_count: 0,
      blocked_ticket_count: 0,
      in_progress_ticket_count: 0,
      ready_ticket_count: 0,
      recent_done_ticket_count: 0,
      owned_goal_count: 0,
      open_goal_count: 0,
      last_ticket_activity_at: null,
    }
    current.recent_done_ticket_count = row.recent_done_ticket_count
    rollups.set(row.agent_id, current)
  }

  for (const row of goalRows) {
    if (!row.agent_id) continue
    const current = rollups.get(row.agent_id) ?? {
      agent_id: row.agent_id,
      open_ticket_count: 0,
      blocked_ticket_count: 0,
      in_progress_ticket_count: 0,
      ready_ticket_count: 0,
      recent_done_ticket_count: 0,
      owned_goal_count: 0,
      open_goal_count: 0,
      last_ticket_activity_at: null,
    }
    current.owned_goal_count = row.owned_goal_count
    current.open_goal_count = row.open_goal_count
    rollups.set(row.agent_id, current)
  }

  return [...rollups.values()].sort((a, b) => {
    if (b.open_ticket_count !== a.open_ticket_count) {
      return b.open_ticket_count - a.open_ticket_count
    }
    return b.open_goal_count - a.open_goal_count
  })
}

export interface AgentAllocationRollup {
  agent_id: string
  primary_team_id: string | null
  team_ids: string[]
  goal_ids: string[]
  owned_goal_ids: string[]
  open_ticket_count: number
  blocked_ticket_count: number
  in_progress_ticket_count: number
  ready_ticket_count: number
  open_goal_count: number
  owned_goal_count: number
  active_session_count: number
  last_ticket_activity_at: number | null
  workload_signal: 'available' | 'steady' | 'thin' | 'overloaded'
  portfolio_impact_score: number
}

export async function listAgentAllocationRollups(opts?: {
  agentIds?: string[]
}): Promise<AgentAllocationRollup[]> {
  const db = getDb()
  const [
    workloadRollups,
    agentTeamRows,
    ticketGoalRows,
    ownedGoalRows,
    directAllocations,
    sessionRows,
  ] = await Promise.all([
    listAgentWorkloadRollups({ agentIds: opts?.agentIds }),
    db
      .selectFrom('agent_teams')
      .select(['agent_id', 'team_id', 'is_primary'])
      .$if(Boolean(opts?.agentIds?.length), (qb) => qb.where('agent_id', 'in', opts!.agentIds!))
      .execute(),
    db
      .selectFrom('tickets')
      .select(['assignee_ref as agent_id', 'goal_id'])
      .where('archived_at', 'is', null)
      .where('assignee_kind', '=', 'agent')
      .where('status', 'in', ['ready', 'in_progress', 'blocked'])
      .where('goal_id', 'is not', null)
      .$if(Boolean(opts?.agentIds?.length), (qb) => qb.where('assignee_ref', 'in', opts!.agentIds!))
      .execute(),
    db
      .selectFrom('goals')
      .select(['owner_ref as agent_id', 'id as goal_id'])
      .where('archived_at', 'is', null)
      .where('owner_kind', '=', 'agent')
      .where('owner_ref', 'is not', null)
      .$if(Boolean(opts?.agentIds?.length), (qb) => qb.where('owner_ref', 'in', opts!.agentIds!))
      .execute(),
    listGoalAgentAllocations({ agentIds: opts?.agentIds }),
    db
      .selectFrom('app_sessions')
      .select(['primary_agent_id as agent_id', sql<number>`count(*)`.as('active_session_count')])
      .$if(Boolean(opts?.agentIds?.length), (qb) =>
        qb.where('primary_agent_id', 'in', opts!.agentIds!)
      )
      .groupBy('primary_agent_id')
      .execute(),
  ])

  const teamIdsByAgent = new Map<string, Set<string>>()
  const primaryTeamByAgent = new Map<string, string>()
  for (const row of agentTeamRows) {
    const teamIds = teamIdsByAgent.get(row.agent_id) ?? new Set<string>()
    teamIds.add(row.team_id)
    teamIdsByAgent.set(row.agent_id, teamIds)
    if (row.is_primary === 1 || !primaryTeamByAgent.has(row.agent_id)) {
      primaryTeamByAgent.set(row.agent_id, row.team_id)
    }
  }

  const goalIdsByAgent = new Map<string, Set<string>>()
  const ownedGoalIdsByAgent = new Map<string, Set<string>>()
  for (const row of ticketGoalRows) {
    if (!row.agent_id || !row.goal_id) continue
    const goalIds = goalIdsByAgent.get(row.agent_id) ?? new Set<string>()
    goalIds.add(row.goal_id)
    goalIdsByAgent.set(row.agent_id, goalIds)
  }
  for (const row of directAllocations) {
    const goalIds = goalIdsByAgent.get(row.agent_id) ?? new Set<string>()
    goalIds.add(row.goal_id)
    goalIdsByAgent.set(row.agent_id, goalIds)
  }
  for (const row of ownedGoalRows) {
    if (!row.agent_id || !row.goal_id) continue
    const goalIds = goalIdsByAgent.get(row.agent_id) ?? new Set<string>()
    goalIds.add(row.goal_id)
    goalIdsByAgent.set(row.agent_id, goalIds)

    const ownedGoalIds = ownedGoalIdsByAgent.get(row.agent_id) ?? new Set<string>()
    ownedGoalIds.add(row.goal_id)
    ownedGoalIdsByAgent.set(row.agent_id, ownedGoalIds)
  }

  const sessionCountByAgent = new Map(
    sessionRows.map((row) => [row.agent_id, row.active_session_count])
  )

  const agentIds = new Set<string>([
    ...workloadRollups.map((row) => row.agent_id),
    ...agentTeamRows.map((row) => row.agent_id),
    ...ticketGoalRows
      .map((row) => row.agent_id)
      .filter((value): value is string => typeof value === 'string'),
    ...ownedGoalRows
      .map((row) => row.agent_id)
      .filter((value): value is string => typeof value === 'string'),
    ...directAllocations.map((row) => row.agent_id),
    ...sessionRows.map((row) => row.agent_id),
  ])

  const workloadByAgent = new Map(workloadRollups.map((row) => [row.agent_id, row]))

  return [...agentIds]
    .map((agentId) => {
      const workload = workloadByAgent.get(agentId)
      const openTicketCount = workload?.open_ticket_count ?? 0
      const blockedTicketCount = workload?.blocked_ticket_count ?? 0
      const openGoalCount = workload?.open_goal_count ?? 0
      const supportedGoalIds = [...(goalIdsByAgent.get(agentId) ?? new Set<string>())]
      const ownedGoalIds = [...(ownedGoalIdsByAgent.get(agentId) ?? new Set<string>())]

      let workloadSignal: AgentAllocationRollup['workload_signal'] = 'available'
      if (openTicketCount >= 6 || blockedTicketCount >= 2 || openGoalCount >= 4) {
        workloadSignal = 'overloaded'
      } else if (openTicketCount >= 4 || openGoalCount >= 3) {
        workloadSignal = 'thin'
      } else if (openTicketCount > 0 || supportedGoalIds.length > 0) {
        workloadSignal = 'steady'
      }

      return {
        agent_id: agentId,
        primary_team_id: primaryTeamByAgent.get(agentId) ?? null,
        team_ids: [...(teamIdsByAgent.get(agentId) ?? new Set<string>())],
        goal_ids: supportedGoalIds,
        owned_goal_ids: ownedGoalIds,
        open_ticket_count: openTicketCount,
        blocked_ticket_count: blockedTicketCount,
        in_progress_ticket_count: workload?.in_progress_ticket_count ?? 0,
        ready_ticket_count: workload?.ready_ticket_count ?? 0,
        open_goal_count: openGoalCount,
        owned_goal_count: workload?.owned_goal_count ?? 0,
        active_session_count: sessionCountByAgent.get(agentId) ?? 0,
        last_ticket_activity_at: workload?.last_ticket_activity_at ?? null,
        workload_signal: workloadSignal,
        portfolio_impact_score:
          supportedGoalIds.length * 3 +
          openTicketCount * 2 +
          blockedTicketCount * 4 +
          ownedGoalIds.length * 2,
      }
    })
    .sort((a, b) => {
      if (b.portfolio_impact_score !== a.portfolio_impact_score) {
        return b.portfolio_impact_score - a.portfolio_impact_score
      }
      return b.open_ticket_count - a.open_ticket_count
    })
}

export type GoalCoverageStatus = 'covered' | 'thin' | 'unstaffed' | 'overloaded'

export interface GoalCoverageRollup {
  goal_id: string
  goal_status: string
  owner_kind: string | null
  owner_ref: string | null
  team_id: string | null
  primary_team_id: string | null
  allocated_agent_ids: string[]
  staffed_agent_ids: string[]
  staffed_team_ids: string[]
  active_team_ids: string[]
  staffing_depth: number
  open_ticket_count: number
  blocked_ticket_count: number
  in_progress_ticket_count: number
  ready_ticket_count: number
  inbox_ticket_count: number
  done_ticket_count: number
  last_activity_at: number
  last_heartbeat_at: number | null
  is_stale: boolean
  health: GoalHealthSummary['health']
  coverage_status: GoalCoverageStatus
}

function isAgentOverloaded(rollup?: AgentWorkloadRollup | null): boolean {
  if (!rollup) return false
  return (
    rollup.open_ticket_count >= 6 || rollup.blocked_ticket_count >= 2 || rollup.open_goal_count >= 4
  )
}

export async function listGoalCoverageRollups(opts?: {
  goalIds?: string[]
  includeArchived?: boolean
}): Promise<GoalCoverageRollup[]> {
  const db = getDb()
  let goalsQuery = db
    .selectFrom('goals')
    .select(['id', 'status', 'owner_kind', 'owner_ref', 'team_id'])

  if (!opts?.includeArchived) {
    goalsQuery = goalsQuery.where('archived_at', 'is', null)
  }

  if (opts?.goalIds && opts.goalIds.length > 0) {
    goalsQuery = goalsQuery.where('id', 'in', opts.goalIds)
  }

  const goals = await goalsQuery.execute()
  if (goals.length === 0) return []

  const goalIds = goals.map((goal) => goal.id)
  const [tickets, healthSummaries, goalAgentAllocations] = await Promise.all([
    db
      .selectFrom('tickets')
      .select(['goal_id', 'status', 'assignee_kind', 'assignee_ref'])
      .where('goal_id', 'in', goalIds)
      .where('archived_at', 'is', null)
      .execute(),
    listGoalHealthSummaries({ goalIds }),
    listGoalAgentAllocations({ goalIds }),
  ])

  const agentIds = [
    ...new Set(
      [
        ...goals
          .filter((goal) => goal.owner_kind === 'agent' && goal.owner_ref)
          .map((goal) => goal.owner_ref as string),
        ...tickets
          .filter((ticket) => ticket.assignee_kind === 'agent' && ticket.assignee_ref)
          .map((ticket) => ticket.assignee_ref as string),
        ...goalAgentAllocations.map((allocation) => allocation.agent_id),
      ].filter(Boolean)
    ),
  ]

  const [agentTeams, agentRollups] = await Promise.all([
    agentIds.length > 0
      ? db
          .selectFrom('agent_teams')
          .select(['agent_id', 'team_id', 'is_primary'])
          .where('agent_id', 'in', agentIds)
          .execute()
      : Promise.resolve([]),
    listAgentWorkloadRollups({ agentIds }),
  ])

  const healthByGoal = new Map(healthSummaries.map((summary) => [summary.goal_id, summary]))
  const workloadByAgent = new Map(agentRollups.map((rollup) => [rollup.agent_id, rollup]))
  const primaryTeamByAgent = new Map<string, string>()
  const allTeamsByAgent = new Map<string, Set<string>>()

  for (const row of agentTeams) {
    const current = allTeamsByAgent.get(row.agent_id) ?? new Set<string>()
    current.add(row.team_id)
    allTeamsByAgent.set(row.agent_id, current)
    if (row.is_primary === 1 || !primaryTeamByAgent.has(row.agent_id)) {
      primaryTeamByAgent.set(row.agent_id, row.team_id)
    }
  }

  const staffingByGoal = new Map<
    string,
    {
      staffedAgents: Set<string>
      staffedTeams: Set<string>
      activeTeams: Set<string>
    }
  >()

  for (const goal of goals) {
    const current = staffingByGoal.get(goal.id) ?? {
      staffedAgents: new Set<string>(),
      staffedTeams: new Set<string>(),
      activeTeams: new Set<string>(),
    }

    if (goal.team_id) {
      current.staffedTeams.add(goal.team_id)
      current.activeTeams.add(goal.team_id)
    }

    if (goal.owner_kind === 'agent' && goal.owner_ref) {
      current.staffedAgents.add(goal.owner_ref)
      const primaryTeamId = primaryTeamByAgent.get(goal.owner_ref)
      if (primaryTeamId) current.activeTeams.add(primaryTeamId)
    }

    if (goal.owner_kind === 'team' && goal.owner_ref) {
      current.staffedTeams.add(goal.owner_ref)
      current.activeTeams.add(goal.owner_ref)
    }

    staffingByGoal.set(goal.id, current)
  }

  for (const allocation of goalAgentAllocations) {
    const current = staffingByGoal.get(allocation.goal_id) ?? {
      staffedAgents: new Set<string>(),
      staffedTeams: new Set<string>(),
      activeTeams: new Set<string>(),
    }
    current.staffedAgents.add(allocation.agent_id)
    const primaryTeamId = primaryTeamByAgent.get(allocation.agent_id)
    if (primaryTeamId) current.activeTeams.add(primaryTeamId)
    const additionalTeams = allTeamsByAgent.get(allocation.agent_id)
    if (additionalTeams) {
      for (const teamId of additionalTeams) current.activeTeams.add(teamId)
    }
    staffingByGoal.set(allocation.goal_id, current)
  }

  for (const ticket of tickets) {
    if (!ticket.goal_id) continue
    if (ticket.status === 'done' || ticket.status === 'canceled') continue

    const current = staffingByGoal.get(ticket.goal_id) ?? {
      staffedAgents: new Set<string>(),
      staffedTeams: new Set<string>(),
      activeTeams: new Set<string>(),
    }

    if (ticket.assignee_kind === 'agent' && ticket.assignee_ref) {
      current.staffedAgents.add(ticket.assignee_ref)
      const primaryTeamId = primaryTeamByAgent.get(ticket.assignee_ref)
      if (primaryTeamId) current.activeTeams.add(primaryTeamId)
      const additionalTeams = allTeamsByAgent.get(ticket.assignee_ref)
      if (additionalTeams) {
        for (const teamId of additionalTeams) current.activeTeams.add(teamId)
      }
    }

    if (ticket.assignee_kind === 'team' && ticket.assignee_ref) {
      current.staffedTeams.add(ticket.assignee_ref)
      current.activeTeams.add(ticket.assignee_ref)
    }

    staffingByGoal.set(ticket.goal_id, current)
  }

  return goals
    .map((goal) => {
      const health = healthByGoal.get(goal.id)
      const staffing = staffingByGoal.get(goal.id) ?? {
        staffedAgents: new Set<string>(),
        staffedTeams: new Set<string>(),
        activeTeams: new Set<string>(),
      }

      const staffedAgentIds = [...staffing.staffedAgents]
      const staffedTeamIds = [...staffing.staffedTeams]
      const activeTeamIds = [...staffing.activeTeams]
      const hasTeamCoverage = activeTeamIds.length > 0
      const allocatedAgentIds = goalAgentAllocations
        .filter((allocation) => allocation.goal_id === goal.id)
        .map((allocation) => allocation.agent_id)
      const allStaffedAgentsOverloaded =
        staffedAgentIds.length > 0 &&
        staffedAgentIds.every((agentId) => isAgentOverloaded(workloadByAgent.get(agentId)))

      let primaryTeamId: string | null = null
      if (goal.team_id) {
        primaryTeamId = goal.team_id
      } else if (goal.owner_kind === 'team' && goal.owner_ref) {
        primaryTeamId = goal.owner_ref
      } else if (goal.owner_kind === 'agent' && goal.owner_ref) {
        primaryTeamId = primaryTeamByAgent.get(goal.owner_ref) ?? null
      } else if (activeTeamIds.length === 1) {
        primaryTeamId = activeTeamIds[0] ?? null
      }

      let coverageStatus: GoalCoverageStatus = 'covered'
      if (staffedAgentIds.length === 0 && !hasTeamCoverage) {
        coverageStatus = 'unstaffed'
      } else if (allStaffedAgentsOverloaded) {
        coverageStatus = 'overloaded'
      } else if (
        (staffedAgentIds.length === 0 && hasTeamCoverage) ||
        (staffedAgentIds.length <= 1 && (health?.open_ticket_count ?? 0) >= 3)
      ) {
        coverageStatus = 'thin'
      }

      return {
        goal_id: goal.id,
        goal_status: goal.status,
        owner_kind: goal.owner_kind,
        owner_ref: goal.owner_ref,
        team_id: goal.team_id,
        primary_team_id: primaryTeamId,
        allocated_agent_ids: allocatedAgentIds,
        staffed_agent_ids: staffedAgentIds,
        staffed_team_ids: staffedTeamIds,
        active_team_ids: activeTeamIds,
        staffing_depth: staffedAgentIds.length,
        open_ticket_count: health?.open_ticket_count ?? 0,
        blocked_ticket_count: health?.blocked_count ?? 0,
        in_progress_ticket_count: health?.in_progress_count ?? 0,
        ready_ticket_count: health?.ready_count ?? 0,
        inbox_ticket_count: health?.inbox_count ?? 0,
        done_ticket_count: health?.done_count ?? 0,
        last_activity_at: health?.last_activity_at ?? 0,
        last_heartbeat_at: health?.last_heartbeat_at ?? null,
        is_stale: health?.is_stale ?? false,
        health: health?.health ?? (goal.status as GoalHealthSummary['health']),
        coverage_status: coverageStatus,
      }
    })
    .sort((a, b) => b.last_activity_at - a.last_activity_at)
}

export interface TeamPortfolioRollup {
  team_id: string
  name: string
  description: string | null
  member_count: number
  agent_count: number
  primary_agent_count: number
  owned_goal_count: number
  staffed_goal_count: number
  active_goal_count: number
  at_risk_goal_count: number
  blocked_goal_count: number
  queued_ticket_count: number
  blocked_ticket_count: number
  goals_needing_staffing_count: number
  overloaded_agent_count: number
  latest_heartbeat_at: number | null
  goal_ids: string[]
}

export async function listTeamPortfolioRollups(opts?: {
  teamIds?: string[]
}): Promise<TeamPortfolioRollup[]> {
  const db = getDb()
  let teamsQuery = db.selectFrom('teams').select(['id', 'name', 'description'])

  if (opts?.teamIds && opts.teamIds.length > 0) {
    teamsQuery = teamsQuery.where('id', 'in', opts.teamIds)
  }

  const teams = await teamsQuery.execute()
  if (teams.length === 0) return []

  const teamIds = teams.map((team) => team.id)
  const [goalCoverage, memberRows, agentRows, teamTicketRows, heartbeatRows] = await Promise.all([
    listGoalCoverageRollups(),
    db
      .selectFrom('team_members')
      .select(['team_id', sql<number>`count(*)`.as('member_count')])
      .where('team_id', 'in', teamIds)
      .groupBy('team_id')
      .execute(),
    db
      .selectFrom('agent_teams')
      .select(['team_id', 'agent_id', 'is_primary'])
      .where('team_id', 'in', teamIds)
      .execute(),
    db
      .selectFrom('tickets')
      .select([
        'assignee_ref as team_id',
        sql<number>`sum(case when status in ('inbox', 'ready', 'in_progress', 'blocked') then 1 else 0 end)`.as(
          'queued_ticket_count'
        ),
        sql<number>`sum(case when status = 'blocked' then 1 else 0 end)`.as('blocked_ticket_count'),
      ])
      .where('archived_at', 'is', null)
      .where('assignee_kind', '=', 'team')
      .where('assignee_ref', 'in', teamIds)
      .groupBy('assignee_ref')
      .execute(),
    db
      .selectFrom('work_updates')
      .select(['team_id', sql<number>`max(created_at)`.as('latest_heartbeat_at')])
      .where('team_id', 'in', teamIds)
      .where('kind', '=', 'heartbeat')
      .groupBy('team_id')
      .execute(),
  ])

  const agentIds = [...new Set(agentRows.map((row) => row.agent_id))]
  const agentWorkloads = await listAgentWorkloadRollups({
    agentIds: agentIds.length > 0 ? agentIds : undefined,
  })
  const workloadByAgent = new Map(agentWorkloads.map((rollup) => [rollup.agent_id, rollup]))
  const memberCountByTeam = new Map(memberRows.map((row) => [row.team_id, row.member_count]))
  const ticketCountByTeam = new Map(
    teamTicketRows
      .filter((row): row is typeof row & { team_id: string } => !!row.team_id)
      .map((row) => [
        row.team_id,
        {
          queued: row.queued_ticket_count,
          blocked: row.blocked_ticket_count,
        },
      ])
  )
  const heartbeatByTeam = new Map(
    heartbeatRows
      .filter((row): row is typeof row & { team_id: string } => !!row.team_id)
      .map((row) => [row.team_id, row.latest_heartbeat_at])
  )

  const agentCountByTeam = new Map<string, number>()
  const primaryAgentCountByTeam = new Map<string, number>()
  const overloadedAgentCountByTeam = new Map<string, number>()
  for (const row of agentRows) {
    agentCountByTeam.set(row.team_id, (agentCountByTeam.get(row.team_id) ?? 0) + 1)
    if (row.is_primary === 1) {
      primaryAgentCountByTeam.set(row.team_id, (primaryAgentCountByTeam.get(row.team_id) ?? 0) + 1)
    }
    if (isAgentOverloaded(workloadByAgent.get(row.agent_id))) {
      overloadedAgentCountByTeam.set(
        row.team_id,
        (overloadedAgentCountByTeam.get(row.team_id) ?? 0) + 1
      )
    }
  }

  const goalStatsByTeam = new Map<
    string,
    {
      owned: number
      staffed: number
      active: number
      atRisk: number
      blocked: number
      needsStaffing: number
      goalIds: string[]
    }
  >()

  for (const goal of goalCoverage) {
    if (goal.goal_status === 'done' || goal.goal_status === 'archived') continue
    for (const teamId of goal.active_team_ids) {
      if (!teamIds.includes(teamId)) continue
      const current = goalStatsByTeam.get(teamId) ?? {
        owned: 0,
        staffed: 0,
        active: 0,
        atRisk: 0,
        blocked: 0,
        needsStaffing: 0,
        goalIds: [],
      }
      current.staffed += 1
      current.active += 1
      if (goal.health === 'at_risk') current.atRisk += 1
      if (goal.health === 'blocked') current.blocked += 1
      if (goal.coverage_status !== 'covered') current.needsStaffing += 1
      if (!current.goalIds.includes(goal.goal_id)) {
        current.goalIds.push(goal.goal_id)
      }
      goalStatsByTeam.set(teamId, current)
    }

    if (goal.primary_team_id && teamIds.includes(goal.primary_team_id)) {
      const current = goalStatsByTeam.get(goal.primary_team_id) ?? {
        owned: 0,
        staffed: 0,
        active: 0,
        atRisk: 0,
        blocked: 0,
        needsStaffing: 0,
        goalIds: [],
      }
      current.owned += 1
      goalStatsByTeam.set(goal.primary_team_id, current)
    }
  }

  return teams
    .map((team) => {
      const goalStats = goalStatsByTeam.get(team.id) ?? {
        owned: 0,
        staffed: 0,
        active: 0,
        atRisk: 0,
        blocked: 0,
        needsStaffing: 0,
        goalIds: [],
      }
      const ticketStats = ticketCountByTeam.get(team.id) ?? { queued: 0, blocked: 0 }

      return {
        team_id: team.id,
        name: team.name,
        description: team.description,
        member_count: memberCountByTeam.get(team.id) ?? 0,
        agent_count: agentCountByTeam.get(team.id) ?? 0,
        primary_agent_count: primaryAgentCountByTeam.get(team.id) ?? 0,
        owned_goal_count: goalStats.owned,
        staffed_goal_count: goalStats.staffed,
        active_goal_count: goalStats.active,
        at_risk_goal_count: goalStats.atRisk,
        blocked_goal_count: goalStats.blocked,
        queued_ticket_count: ticketStats.queued,
        blocked_ticket_count: ticketStats.blocked,
        goals_needing_staffing_count: goalStats.needsStaffing,
        overloaded_agent_count: overloadedAgentCountByTeam.get(team.id) ?? 0,
        latest_heartbeat_at: heartbeatByTeam.get(team.id) ?? null,
        goal_ids: goalStats.goalIds,
      }
    })
    .sort((a, b) => {
      if (b.active_goal_count !== a.active_goal_count) {
        return b.active_goal_count - a.active_goal_count
      }
      return b.queued_ticket_count - a.queued_ticket_count
    })
}

export interface CompanyOverviewRollup {
  active_goal_count: number
  at_risk_goal_count: number
  blocked_goal_count: number
  staffed_goal_count: number
  unstaffed_goal_count: number
  thin_goal_count: number
  overloaded_goal_count: number
  active_team_count: number
  overloaded_agent_count: number
}

export async function getCompanyOverviewRollup(): Promise<CompanyOverviewRollup> {
  const [goalCoverage, teamRollups, agentRollups] = await Promise.all([
    listGoalCoverageRollups(),
    listTeamPortfolioRollups(),
    listAgentWorkloadRollups(),
  ])

  return {
    active_goal_count: goalCoverage.filter(
      (goal) => goal.goal_status !== 'done' && goal.goal_status !== 'archived'
    ).length,
    at_risk_goal_count: goalCoverage.filter((goal) => goal.health === 'at_risk').length,
    blocked_goal_count: goalCoverage.filter((goal) => goal.health === 'blocked').length,
    staffed_goal_count: goalCoverage.filter((goal) => goal.coverage_status !== 'unstaffed').length,
    unstaffed_goal_count: goalCoverage.filter((goal) => goal.coverage_status === 'unstaffed')
      .length,
    thin_goal_count: goalCoverage.filter((goal) => goal.coverage_status === 'thin').length,
    overloaded_goal_count: goalCoverage.filter((goal) => goal.coverage_status === 'overloaded')
      .length,
    active_team_count: teamRollups.filter(
      (team) => team.active_goal_count > 0 || team.queued_ticket_count > 0
    ).length,
    overloaded_agent_count: agentRollups.filter((rollup) => isAgentOverloaded(rollup)).length,
  }
}
