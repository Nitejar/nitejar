import { TRPCError } from '@trpc/server'
import { parseAgentConfig } from '@nitejar/agent/config'
import {
  addAppSessionParticipants,
  claimTicket,
  createAppSession,
  createGoal,
  createRoutine,
  createTicket,
  createTicketLink,
  createWorkView,
  createWorkUpdate,
  deleteWorkView,
  findAppSessionByKey,
  findGoalById,
  findTicketById,
  findTicketBySessionKey,
  findTicketByWorkItemId,
  findWorkViewById,
  getDb,
  listGoals,
  listGoalHealthSummaries,
  listAgentWorkloadRollups,
  listInitiatives,
  listLinkedWorkItemsForTicket,
  listRelatedTickets,
  listTicketRelations,
  listTicketLinksByTicket,
  listTicketWorkloadRollups,
  listTickets,
  listUntrackedAppSessions,
  listWorkViews,
  listWorkUpdates,
  sql,
  WORK_TICKET_STALE_AFTER_SECONDS,
  updateRoutine,
  updateGoal,
  updateTicket,
  updateWorkView,
} from '@nitejar/database'
import { z } from 'zod'
import { validateCronSchedule } from '../services/routines/cron'
import { getAlwaysTrueRuleForEnvelope } from '../services/routines/rules'
import { protectedProcedure, router } from '../trpc'

const goalStatusSchema = z.enum(['draft', 'active', 'at_risk', 'blocked', 'done', 'archived'])
const ticketStatusSchema = z.enum(['inbox', 'ready', 'in_progress', 'blocked', 'done', 'canceled'])
const actorKindSchema = z.enum(['user', 'agent', 'team'])
const ticketLinkKindSchema = z.enum(['session', 'work_item', 'external'])
const heartbeatTargetKindSchema = z.enum(['goal', 'team'])
const workViewEntityKindSchema = z.enum(['goal', 'ticket'])
const sortDirectionSchema = z.enum(['asc', 'desc'])
const goalSortFieldSchema = z.enum(['updated_at', 'created_at', 'title', 'status'])
const ticketSortFieldSchema = z.enum(['updated_at', 'created_at', 'title', 'status'])

const goalListInputSchema = z.object({
  statuses: z.array(goalStatusSchema).optional(),
  q: z.string().trim().optional(),
  ownerKind: actorKindSchema.optional(),
  ownerRef: z.string().trim().optional(),
  teamId: z.string().trim().optional(),
  initiativeId: z.string().trim().optional(),
  staleOnly: z.boolean().default(false),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(100),
  sort: z
    .object({
      field: goalSortFieldSchema,
      direction: sortDirectionSchema.default('desc'),
    })
    .optional(),
})

const ticketListInputSchema = z.object({
  scope: z.enum(['mine', 'my_team', 'unclaimed', 'all']).default('all'),
  statuses: z.array(ticketStatusSchema).optional(),
  q: z.string().trim().optional(),
  goalId: z.string().trim().optional().nullable(),
  assigneeKind: actorKindSchema.optional(),
  assigneeRef: z.string().trim().optional(),
  staleOnly: z.boolean().default(false),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(100),
  sort: z
    .object({
      field: ticketSortFieldSchema,
      direction: sortDirectionSchema.default('desc'),
    })
    .optional(),
})

const goalViewSchema = z.object({
  entityKind: z.literal('goal'),
  name: z.string().trim().min(1).max(80),
  filters: goalListInputSchema,
  groupBy: z.enum(['status', 'owner', 'team', 'health']).optional().nullable(),
})

const ticketViewSchema = z.object({
  entityKind: z.literal('ticket'),
  name: z.string().trim().min(1).max(80),
  filters: ticketListInputSchema,
  groupBy: z.enum(['status', 'goal', 'assignee']).optional().nullable(),
})

type HeartbeatTargetKind = z.infer<typeof heartbeatTargetKindSchema>

type ResolvedActor = {
  kind: 'user' | 'agent' | 'team'
  ref: string
  label: string
  handle?: string | null
  title?: string | null
  avatarUrl?: string | null
  emoji?: string | null
} | null

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function requireUserId(session: unknown): string {
  const userId =
    session &&
    typeof session === 'object' &&
    'user' in session &&
    session.user &&
    typeof session.user === 'object' &&
    'id' in session.user &&
    typeof session.user.id === 'string'
      ? session.user.id
      : null
  if (!userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return userId
}

function requireFirst<T>(rows: T[], entityLabel: string): T {
  const row = rows[0]
  if (!row) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to resolve ${entityLabel}.`,
    })
  }
  return row
}

function resolveTicketAssignmentPatch(args: {
  existing: {
    assignee_kind: string | null
    assignee_ref: string | null
    claimed_by_kind: string | null
    claimed_by_ref: string | null
    claimed_at: number | null
  }
  patch: {
    assigneeKind?: 'user' | 'agent' | 'team' | null
    assigneeRef?: string | null
  }
  actorUserId: string
}) {
  const assigneeKind =
    args.patch.assigneeKind === undefined
      ? args.existing.assignee_kind
      : (args.patch.assigneeKind ?? null)

  const assigneeRef =
    args.patch.assigneeKind !== undefined && args.patch.assigneeKind === null
      ? null
      : args.patch.assigneeRef === undefined
        ? args.existing.assignee_ref
        : (args.patch.assigneeRef ?? null)

  if (assigneeKind && !assigneeRef) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Assigned tickets require a target reference.',
    })
  }

  const assignmentChanged =
    assigneeKind !== args.existing.assignee_kind || assigneeRef !== args.existing.assignee_ref

  if (!assignmentChanged) {
    return {
      assigneeKind,
      assigneeRef,
      claimedByKind: args.existing.claimed_by_kind,
      claimedByRef: args.existing.claimed_by_ref,
      claimedAt: args.existing.claimed_at,
    }
  }

  if ((assigneeKind === 'user' || assigneeKind === 'agent') && assigneeRef) {
    return {
      assigneeKind,
      assigneeRef,
      claimedByKind: 'user' as const,
      claimedByRef: args.actorUserId,
      claimedAt: now(),
    }
  }

  return {
    assigneeKind,
    assigneeRef: assigneeKind ? assigneeRef : null,
    claimedByKind: null,
    claimedByRef: null,
    claimedAt: null,
  }
}

function parseStoredJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function presentWorkView(row: {
  id: string
  scope: string
  entity_kind: string
  name: string
  filters_json: string
  sort_json: string | null
  group_by: string | null
  created_at: number
  updated_at: number
}) {
  return {
    id: row.id,
    scope: row.scope,
    entityKind: row.entity_kind,
    name: row.name,
    filters: parseStoredJson<Record<string, unknown>>(row.filters_json, {}),
    sort: parseStoredJson<Record<string, unknown> | null>(row.sort_json, null),
    groupBy: row.group_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function buildHeartbeatSessionKey(targetKind: HeartbeatTargetKind, targetId: string): string {
  return `work:${targetKind}:${targetId}:heartbeat`
}

function buildHeartbeatContext(targetKind: HeartbeatTargetKind, targetId: string): string {
  return JSON.stringify({
    kind: 'work_heartbeat',
    targetKind,
    targetId,
  })
}

function buildGoalHeartbeatPrompt(goal: { id: string; title: string; outcome: string }): string {
  return [
    `You are running the recurring heartbeat for goal ${goal.id}: "${goal.title}".`,
    `Goal outcome: ${goal.outcome}`,
    '',
    'Review the active work before you summarize it:',
    `- Use search_tickets with goal_id="${goal.id}" and status="ready,in_progress,blocked".`,
    '- Use get_ticket on any ticket that looks important, blocked, stale, or expensive.',
    '',
    `Then post exactly one heartbeat update with post_work_update using goal_id="${goal.id}" and kind="heartbeat".`,
    'The update should cover current progress, blockers, workload risk, and the next concrete move.',
    'Keep it concise and human-readable.',
  ].join('\n')
}

function buildTeamHeartbeatPrompt(team: {
  id: string
  name: string
  description: string | null
}): string {
  return [
    `You are running the recurring heartbeat for team ${team.id}: "${team.name}".`,
    team.description
      ? `Team charter: ${team.description}`
      : 'Review the team queue and owned goals.',
    '',
    'Review the work before you summarize it:',
    `- Use search_goals with owner_kind="team" and owner_ref="${team.id}".`,
    `- Use search_tickets with assignee_kind="team" and assignee_ref="${team.id}" and status="inbox,ready,in_progress,blocked".`,
    '- Use get_ticket on any ticket that looks blocked, stale, or important.',
    '',
    `Then post exactly one heartbeat update with post_work_update using team_id="${team.id}" and kind="heartbeat".`,
    'The update should cover queue health, blockers, ownership gaps, overload risk, and the next concrete move.',
    'Keep it concise and human-readable.',
  ].join('\n')
}

async function ensureHeartbeatSession(input: {
  sessionKey: string
  title: string
  ownerUserId: string
  agentId: string
}): Promise<void> {
  const db = getDb()
  const existing = await findAppSessionByKey(input.sessionKey)

  if (!existing) {
    await createAppSession({
      session_key: input.sessionKey,
      owner_user_id: input.ownerUserId,
      title: input.title,
      primary_agent_id: input.agentId,
    })
  } else {
    await db
      .updateTable('app_sessions')
      .set({
        title: input.title,
        primary_agent_id: input.agentId,
        updated_at: now(),
      })
      .where('session_key', '=', input.sessionKey)
      .execute()
  }

  await addAppSessionParticipants({
    sessionKey: input.sessionKey,
    agentIds: [input.agentId],
    addedByUserId: input.ownerUserId,
  })
}

async function findHeartbeatRoutineConfig(targetKind: HeartbeatTargetKind, targetId: string) {
  const db = getDb()
  const sessionKey = buildHeartbeatSessionKey(targetKind, targetId)
  const routine = await db
    .selectFrom('routines')
    .selectAll()
    .where('target_session_key', '=', sessionKey)
    .where('archived_at', 'is', null)
    .orderBy('created_at', 'desc')
    .executeTakeFirst()

  if (!routine) {
    return null
  }

  const agent = await db
    .selectFrom('agents')
    .select(['id', 'name', 'handle'])
    .where('id', '=', routine.agent_id)
    .executeTakeFirst()

  return {
    id: routine.id,
    sessionKey,
    agentId: routine.agent_id,
    agentName: agent?.name ?? null,
    agentHandle: agent?.handle ?? null,
    enabled: routine.enabled === 1,
    cronExpr: routine.cron_expr,
    timezone: routine.timezone,
    nextRunAt: routine.next_run_at,
    lastEvaluatedAt: routine.last_evaluated_at,
    lastFiredAt: routine.last_fired_at,
    lastStatus: routine.last_status,
  }
}

async function resolveActors(refs: Array<{ kind: string | null; ref: string | null }>): Promise<{
  users: Map<string, { id: string; name: string; avatarUrl: string | null }>
  agents: Map<
    string,
    {
      id: string
      name: string
      handle: string
      title: string | null
      avatarUrl: string | null
      emoji: string | null
    }
  >
  teams: Map<string, { id: string; name: string }>
}> {
  const db = getDb()
  const userIds = [
    ...new Set(refs.filter((ref) => ref.kind === 'user' && ref.ref).map((ref) => ref.ref!)),
  ]
  const agentIds = [
    ...new Set(refs.filter((ref) => ref.kind === 'agent' && ref.ref).map((ref) => ref.ref!)),
  ]
  const teamIds = [
    ...new Set(refs.filter((ref) => ref.kind === 'team' && ref.ref).map((ref) => ref.ref!)),
  ]

  const [users, agents, teams] = await Promise.all([
    userIds.length > 0
      ? db
          .selectFrom('users')
          .select(['id', 'name', 'avatar_url'])
          .where('id', 'in', userIds)
          .execute()
      : Promise.resolve([]),
    agentIds.length > 0
      ? db
          .selectFrom('agents')
          .select(['id', 'name', 'handle', 'config'])
          .where('id', 'in', agentIds)
          .execute()
      : Promise.resolve([]),
    teamIds.length > 0
      ? db.selectFrom('teams').select(['id', 'name']).where('id', 'in', teamIds).execute()
      : Promise.resolve([]),
  ])

  return {
    users: new Map(
      users.map((user) => [
        user.id,
        {
          id: user.id,
          name: user.name,
          avatarUrl: user.avatar_url,
        },
      ])
    ),
    agents: new Map(
      agents.map((agent) => {
        const parsed = parseAgentConfig(agent.config)
        return [
          agent.id,
          {
            id: agent.id,
            name: agent.name,
            handle: agent.handle,
            title: parsed.title ?? null,
            avatarUrl: parsed.avatarUrl ?? null,
            emoji: parsed.emoji ?? null,
          },
        ]
      })
    ),
    teams: new Map(teams.map((team) => [team.id, { id: team.id, name: team.name }])),
  }
}

function presentActor(
  kind: string | null,
  ref: string | null,
  resolved: Awaited<ReturnType<typeof resolveActors>>
): ResolvedActor {
  if (!kind || !ref) return null

  if (kind === 'user') {
    const user = resolved.users.get(ref)
    return user
      ? {
          kind: 'user',
          ref,
          label: user.name,
          avatarUrl: user.avatarUrl,
        }
      : null
  }

  if (kind === 'agent') {
    const agent = resolved.agents.get(ref)
    return agent
      ? {
          kind: 'agent',
          ref,
          label: agent.name,
          handle: agent.handle,
          title: agent.title,
          avatarUrl: agent.avatarUrl,
          emoji: agent.emoji,
        }
      : null
  }

  if (kind === 'team') {
    const team = resolved.teams.get(ref)
    return team
      ? {
          kind: 'team',
          ref,
          label: team.name,
        }
      : null
  }

  return null
}

async function enrichGoals(rows: Awaited<ReturnType<typeof listGoals>>) {
  if (rows.length === 0) return []
  const db = getDb()
  const goalIds = rows.map((row) => row.id)
  const initiativeIds = [
    ...new Set(
      rows
        .map((row) => row.initiative_id)
        .filter((initiativeId): initiativeId is string => !!initiativeId)
    ),
  ]
  const parentGoalIds = [
    ...new Set(
      rows.map((row) => row.parent_goal_id).filter((goalId): goalId is string => !!goalId)
    ),
  ]
  const [tickets, updates, childGoals, initiatives, parentGoals, actors, healthSummaries] =
    await Promise.all([
      db
        .selectFrom('tickets')
        .select(['id', 'goal_id', 'status'])
        .where('goal_id', 'in', goalIds)
        .where('archived_at', 'is', null)
        .execute(),
      db
        .selectFrom('work_updates')
        .select(['goal_id', 'body', 'kind', 'created_at'])
        .where('goal_id', 'in', goalIds)
        .orderBy('created_at', 'desc')
        .execute(),
      db
        .selectFrom('goals')
        .select(['id', 'parent_goal_id'])
        .where('parent_goal_id', 'in', goalIds)
        .where('archived_at', 'is', null)
        .execute(),
      initiativeIds.length > 0
        ? db
            .selectFrom('initiatives')
            .select(['id', 'title', 'status', 'target_label'])
            .where('id', 'in', initiativeIds)
            .execute()
        : Promise.resolve([]),
      parentGoalIds.length > 0
        ? db
            .selectFrom('goals')
            .select(['id', 'title', 'status'])
            .where('id', 'in', parentGoalIds)
            .execute()
        : Promise.resolve([]),
      resolveActors(rows.map((row) => ({ kind: row.owner_kind, ref: row.owner_ref }))),
      listGoalHealthSummaries({ goalIds }),
    ])

  const ticketCounts = new Map<
    string,
    {
      total: number
      inbox: number
      ready: number
      in_progress: number
      blocked: number
      done: number
    }
  >()
  for (const ticket of tickets) {
    const current = ticketCounts.get(ticket.goal_id ?? '') ?? {
      total: 0,
      inbox: 0,
      ready: 0,
      in_progress: 0,
      blocked: 0,
      done: 0,
    }
    current.total += 1
    if (ticket.status === 'inbox') current.inbox += 1
    if (ticket.status === 'ready') current.ready += 1
    if (ticket.status === 'in_progress') current.in_progress += 1
    if (ticket.status === 'blocked') current.blocked += 1
    if (ticket.status === 'done') current.done += 1
    ticketCounts.set(ticket.goal_id ?? '', current)
  }

  const latestUpdates = new Map<string, { body: string; kind: string; createdAt: number }>()
  for (const update of updates) {
    if (!update.goal_id || latestUpdates.has(update.goal_id)) continue
    latestUpdates.set(update.goal_id, {
      body: update.body,
      kind: update.kind,
      createdAt: update.created_at,
    })
  }

  const childCounts = new Map<string, number>()
  for (const child of childGoals) {
    if (!child.parent_goal_id) continue
    childCounts.set(child.parent_goal_id, (childCounts.get(child.parent_goal_id) ?? 0) + 1)
  }

  const initiativeMap = new Map(initiatives.map((initiative) => [initiative.id, initiative]))
  const parentGoalMap = new Map(parentGoals.map((goal) => [goal.id, goal]))
  const healthByGoal = new Map(healthSummaries.map((summary) => [summary.goal_id, summary]))

  return rows.map((row) => {
    const health = healthByGoal.get(row.id)
    return {
      id: row.id,
      initiative:
        row.initiative_id && initiativeMap.has(row.initiative_id)
          ? {
              id: row.initiative_id,
              title: initiativeMap.get(row.initiative_id)?.title ?? 'Initiative',
              status: initiativeMap.get(row.initiative_id)?.status ?? 'active',
              targetLabel: initiativeMap.get(row.initiative_id)?.target_label ?? null,
            }
          : null,
      parentGoalId: row.parent_goal_id,
      parentGoal:
        row.parent_goal_id && parentGoalMap.has(row.parent_goal_id)
          ? {
              id: row.parent_goal_id,
              title: parentGoalMap.get(row.parent_goal_id)?.title ?? 'Parent goal',
              status: parentGoalMap.get(row.parent_goal_id)?.status ?? 'active',
            }
          : null,
      title: row.title,
      outcome: row.outcome,
      status: row.status,
      health: health?.health ?? row.status,
      isStale: health?.is_stale ?? false,
      owner: presentActor(row.owner_kind, row.owner_ref, actors),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActivityAt: health?.last_activity_at ?? row.updated_at,
      lastHeartbeatAt: health?.last_heartbeat_at ?? null,
      archivedAt: row.archived_at,
      childGoalCount: childCounts.get(row.id) ?? 0,
      ticketCounts: ticketCounts.get(row.id) ?? {
        total: 0,
        inbox: 0,
        ready: 0,
        in_progress: 0,
        blocked: 0,
        done: 0,
      },
      latestUpdate: latestUpdates.get(row.id) ?? null,
    }
  })
}

async function enrichTickets(rows: Awaited<ReturnType<typeof listTickets>>) {
  if (rows.length === 0) return []
  const db = getDb()
  const ticketIds = rows.map((row) => row.id)
  const goalIds = [
    ...new Set(rows.map((row) => row.goal_id).filter((goalId): goalId is string => !!goalId)),
  ]
  const parentTicketIds = [
    ...new Set(
      rows.map((row) => row.parent_ticket_id).filter((ticketId): ticketId is string => !!ticketId)
    ),
  ]

  const [goals, initiatives, updates, links, relations, childTickets, parentTickets, actors] =
    await Promise.all([
      goalIds.length > 0
        ? db
            .selectFrom('goals')
            .select(['id', 'title', 'status', 'initiative_id'])
            .where('id', 'in', goalIds)
            .execute()
        : Promise.resolve([]),
      goalIds.length > 0
        ? db
            .selectFrom('initiatives')
            .select(['id', 'title', 'status'])
            .where(
              'id',
              'in',
              db
                .selectFrom('goals')
                .select('initiative_id')
                .where('id', 'in', goalIds)
                .where('initiative_id', 'is not', null)
            )
            .execute()
        : Promise.resolve([]),
      db
        .selectFrom('work_updates')
        .select(['ticket_id', 'body', 'kind', 'created_at'])
        .where('ticket_id', 'in', ticketIds)
        .orderBy('created_at', 'desc')
        .execute(),
      db
        .selectFrom('ticket_links')
        .select(['ticket_id', 'kind', 'ref', 'label'])
        .where('ticket_id', 'in', ticketIds)
        .orderBy('created_at', 'desc')
        .execute(),
      listTicketRelations({
        ticketIds,
        relatedTicketIds: ticketIds,
        kinds: ['blocked_by', 'related_to'],
      }),
      db
        .selectFrom('tickets')
        .select(['id', 'parent_ticket_id'])
        .where('parent_ticket_id', 'in', ticketIds)
        .where('archived_at', 'is', null)
        .execute(),
      parentTicketIds.length > 0
        ? db
            .selectFrom('tickets')
            .select(['id', 'title', 'status'])
            .where('id', 'in', parentTicketIds)
            .execute()
        : Promise.resolve([]),
      resolveActors(rows.map((row) => ({ kind: row.assignee_kind, ref: row.assignee_ref }))),
    ])

  const goalMap = new Map(goals.map((goal) => [goal.id, goal]))
  const initiativeMap = new Map(initiatives.map((initiative) => [initiative.id, initiative]))
  const latestUpdates = new Map<string, { body: string; kind: string; createdAt: number }>()
  for (const update of updates) {
    if (!update.ticket_id || latestUpdates.has(update.ticket_id)) continue
    latestUpdates.set(update.ticket_id, {
      body: update.body,
      kind: update.kind,
      createdAt: update.created_at,
    })
  }

  const linksByTicket = new Map<
    string,
    Array<{ kind: string; ref: string; label: string | null }>
  >()
  for (const link of links) {
    const current = linksByTicket.get(link.ticket_id) ?? []
    current.push({
      kind: link.kind,
      ref: link.ref,
      label: link.label,
    })
    linksByTicket.set(link.ticket_id, current)
  }

  const parentTicketMap = new Map(parentTickets.map((ticket) => [ticket.id, ticket]))
  const childCountByTicket = new Map<string, number>()
  for (const child of childTickets) {
    if (!child.parent_ticket_id) continue
    childCountByTicket.set(
      child.parent_ticket_id,
      (childCountByTicket.get(child.parent_ticket_id) ?? 0) + 1
    )
  }

  const relationCountsByTicket = new Map<
    string,
    { blockedByCount: number; blockingCount: number; relatedCount: number }
  >()
  for (const relation of relations) {
    const current = relationCountsByTicket.get(relation.ticket_id) ?? {
      blockedByCount: 0,
      blockingCount: 0,
      relatedCount: 0,
    }
    if (relation.kind === 'blocked_by') current.blockedByCount += 1
    if (relation.kind === 'related_to') current.relatedCount += 1
    relationCountsByTicket.set(relation.ticket_id, current)

    const inverse = relationCountsByTicket.get(relation.related_ticket_id) ?? {
      blockedByCount: 0,
      blockingCount: 0,
      relatedCount: 0,
    }
    if (relation.kind === 'blocked_by') inverse.blockingCount += 1
    if (relation.kind === 'related_to') inverse.relatedCount += 1
    relationCountsByTicket.set(relation.related_ticket_id, inverse)
  }

  return rows.map((row) => ({
    id: row.id,
    parentTicketId: row.parent_ticket_id,
    parentTicket:
      row.parent_ticket_id && parentTicketMap.has(row.parent_ticket_id)
        ? {
            id: row.parent_ticket_id,
            title: parentTicketMap.get(row.parent_ticket_id)?.title ?? 'Parent ticket',
            status: parentTicketMap.get(row.parent_ticket_id)?.status ?? 'inbox',
          }
        : null,
    childTicketCount: childCountByTicket.get(row.id) ?? 0,
    title: row.title,
    body: row.body,
    status: row.status,
    goal:
      row.goal_id && goalMap.has(row.goal_id)
        ? {
            id: row.goal_id,
            title: goalMap.get(row.goal_id)?.title ?? 'Goal',
            status: goalMap.get(row.goal_id)?.status ?? 'draft',
            initiative:
              goalMap.get(row.goal_id)?.initiative_id &&
              initiativeMap.has(goalMap.get(row.goal_id)?.initiative_id ?? '')
                ? {
                    id: goalMap.get(row.goal_id)?.initiative_id ?? '',
                    title:
                      initiativeMap.get(goalMap.get(row.goal_id)?.initiative_id ?? '')?.title ??
                      'Initiative',
                    status:
                      initiativeMap.get(goalMap.get(row.goal_id)?.initiative_id ?? '')?.status ??
                      'active',
                  }
                : null,
          }
        : null,
    assignee: presentActor(row.assignee_kind, row.assignee_ref, actors),
    isUnclaimed: !row.assignee_kind || row.assignee_kind === 'team',
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    latestUpdate: latestUpdates.get(row.id) ?? null,
    links: linksByTicket.get(row.id) ?? [],
    blockedByCount: relationCountsByTicket.get(row.id)?.blockedByCount ?? 0,
    blockingCount: relationCountsByTicket.get(row.id)?.blockingCount ?? 0,
    relatedTicketCount: relationCountsByTicket.get(row.id)?.relatedCount ?? 0,
  }))
}

async function buildTicketReceiptSummary(ticketId: string) {
  const db = getDb()
  const [links, workItems] = await Promise.all([
    listTicketLinksByTicket(ticketId),
    listLinkedWorkItemsForTicket(ticketId),
  ])

  const workItemIds = workItems.map((item) => item.id)
  const sessionKeys = [...new Set(workItems.map((item) => item.session_key))]

  const [jobs, activityEntries, costRow] = await Promise.all([
    workItemIds.length > 0
      ? db
          .selectFrom('jobs')
          .select(['id', 'work_item_id', 'agent_id', 'status', 'created_at', 'completed_at'])
          .where('work_item_id', 'in', workItemIds)
          .orderBy('created_at', 'desc')
          .execute()
      : Promise.resolve([]),
    sessionKeys.length > 0
      ? db
          .selectFrom('activity_log')
          .select([
            'id',
            'agent_id',
            'agent_handle',
            'status',
            'summary',
            'final_summary',
            'created_at',
            'session_key',
          ])
          .where('session_key', 'in', sessionKeys)
          .orderBy('created_at', 'desc')
          .limit(12)
          .execute()
      : Promise.resolve([]),
    workItemIds.length > 0
      ? db
          .selectFrom('inference_calls')
          .innerJoin('jobs', 'jobs.id', 'inference_calls.job_id')
          .select((eb) =>
            eb.fn
              .coalesce(eb.fn.sum<number>('inference_calls.cost_usd'), sql<number>`0`)
              .as('total')
          )
          .where('jobs.work_item_id', 'in', workItemIds)
          .executeTakeFirst()
      : Promise.resolve({ total: 0 }),
  ])

  return {
    links: links.map((link) => ({
      id: link.id,
      kind: link.kind,
      ref: link.ref,
      label: link.label,
      metadataJson: link.metadata_json,
      createdAt: link.created_at,
    })),
    workItems: workItems.map((item) => ({
      id: item.id,
      title: item.title,
      source: item.source,
      sourceRef: item.source_ref,
      sessionKey: item.session_key,
      status: item.status,
      createdAt: item.created_at,
    })),
    jobs: jobs.map((job) => ({
      id: job.id,
      workItemId: job.work_item_id,
      agentId: job.agent_id,
      status: job.status,
      createdAt: job.created_at,
      completedAt: job.completed_at,
    })),
    activity: activityEntries.map((entry) => ({
      id: entry.id,
      agentId: entry.agent_id,
      agentHandle: entry.agent_handle,
      status: entry.status,
      summary: entry.final_summary ?? entry.summary,
      createdAt: entry.created_at,
      sessionKey: entry.session_key,
    })),
    totalCostUsd: Number(costRow?.total ?? 0),
  }
}

export const workRouter = router({
  getDashboard: protectedProcedure.query(async ({ ctx }) => {
    const userId = requireUserId(ctx.session)
    const db = getDb()
    const staleBefore = now() - WORK_TICKET_STALE_AFTER_SECONDS

    const [
      goals,
      openTickets,
      recentUpdates,
      heartbeatUpdates,
      teamMemberships,
      untrackedWork,
      workloadRollups,
      agentRollups,
    ] = await Promise.all([
      listGoals({ includeArchived: false }),
      listTickets({
        statuses: ['inbox', 'ready', 'in_progress', 'blocked'],
        includeArchived: false,
        limit: 200,
      }),
      listWorkUpdates({ limit: 10 }),
      listWorkUpdates({ kinds: ['heartbeat'], limit: 5 }),
      db.selectFrom('team_members').select(['team_id']).where('user_id', '=', userId).execute(),
      listUntrackedAppSessions({ ownerUserId: userId, limit: 6 }),
      listTicketWorkloadRollups({
        statuses: ['ready', 'in_progress', 'blocked'],
        limit: 12,
      }),
      listAgentWorkloadRollups(),
    ])

    const goalRows = await enrichGoals(goals)
    const ticketRows = await enrichTickets(openTickets)
    const workloadActors = await resolveActors(
      workloadRollups.map((entry) => ({
        kind: entry.assignee_kind,
        ref: entry.assignee_ref,
      }))
    )

    const myTeamIds = new Set(teamMemberships.map((membership) => membership.team_id))
    const atRiskGoals = goalRows.filter(
      (goal) => goal.health === 'at_risk' || goal.health === 'blocked'
    )
    const blockedTickets = ticketRows.filter((ticket) => ticket.status === 'blocked')
    const unclaimedTickets = ticketRows.filter((ticket) => ticket.isUnclaimed)
    const staleTickets = ticketRows.filter(
      (ticket) => ticket.updatedAt <= staleBefore && ticket.status !== 'done'
    )
    const activeTickets = ticketRows.filter((ticket) => ticket.status === 'in_progress')
    const myTickets = ticketRows.filter(
      (ticket) => ticket.assignee?.kind === 'user' && ticket.assignee.ref === userId
    )
    const myTeamTickets = ticketRows.filter(
      (ticket) => ticket.assignee?.kind === 'team' && myTeamIds.has(ticket.assignee.ref)
    )
    const agentRollupMap = new Map(agentRollups.map((rollup) => [rollup.agent_id, rollup]))
    const workload = workloadRollups.map((entry) => {
      const actor =
        entry.assignee_kind && entry.assignee_ref
          ? presentActor(entry.assignee_kind, entry.assignee_ref, workloadActors)
          : null
      const overloaded =
        entry.open_count >= 6 || entry.blocked_count >= 2 || entry.in_progress_count >= 4
      return {
        key:
          entry.assignee_kind && entry.assignee_ref
            ? `${entry.assignee_kind}:${entry.assignee_ref}`
            : 'unassigned',
        label: actor?.label ?? 'Unassigned',
        kind: actor?.kind ?? 'unassigned',
        count: entry.open_count,
        blockedCount: entry.blocked_count,
        inProgressCount: entry.in_progress_count,
        oldestUpdatedAt: entry.oldest_updated_at,
        overloaded,
      }
    })
    const overloadedAgents = goalRows
      .flatMap((goal) => (goal.owner?.kind === 'agent' ? [goal.owner] : []))
      .filter((owner, index, list) => list.findIndex((item) => item.ref === owner.ref) === index)
      .map((owner) => ({
        ...owner,
        workload: agentRollupMap.get(owner.ref),
      }))
      .filter(
        (owner) =>
          (owner.workload?.open_ticket_count ?? 0) >= 6 ||
          (owner.workload?.blocked_ticket_count ?? 0) >= 2
      )
      .slice(0, 6)

    return {
      summary: {
        goalCount: goalRows.length,
        openGoalCount: goalRows.filter((goal) => !['done', 'archived'].includes(goal.status))
          .length,
        atRiskGoalCount: goalRows.filter(
          (goal) => goal.health === 'at_risk' || goal.health === 'blocked'
        ).length,
        openTicketCount: ticketRows.length,
        blockedTicketCount: blockedTickets.length,
        unclaimedTicketCount: unclaimedTickets.length,
        staleTicketCount: staleTickets.length,
        activeTicketCount: activeTickets.length,
        myTicketCount: myTickets.length,
        myTeamTicketCount: myTeamTickets.length,
      },
      atRiskGoals: atRiskGoals.slice(0, 6),
      blockedTickets: blockedTickets.slice(0, 6),
      unclaimedTickets: unclaimedTickets.slice(0, 6),
      staleTickets: staleTickets.slice(0, 6),
      activeTickets: activeTickets.slice(0, 6),
      recentUpdates: recentUpdates.slice(0, 8),
      heartbeatUpdates: heartbeatUpdates.slice(0, 5),
      workload: workload.slice(0, 8),
      overloadedAgents,
      untrackedWork,
      orgSummary:
        heartbeatUpdates[0]?.body ??
        `${atRiskGoals.length} at-risk goals, ${blockedTickets.length} blocked tickets, ${unclaimedTickets.length} unclaimed tickets.`,
    }
  }),

  listUpdates: protectedProcedure
    .input(
      z
        .object({
          goalId: z.string().trim().optional(),
          ticketId: z.string().trim().optional(),
          teamId: z.string().trim().optional(),
          kinds: z.array(z.enum(['note', 'status', 'heartbeat'])).optional(),
          limit: z.number().int().min(1).max(100).default(20),
        })
        .optional()
    )
    .query(async ({ input }) =>
      listWorkUpdates({
        goalId: input?.goalId,
        ticketId: input?.ticketId,
        teamId: input?.teamId,
        kinds: input?.kinds,
        limit: input?.limit,
      })
    ),

  getHeartbeatConfig: protectedProcedure
    .input(
      z.object({
        targetKind: heartbeatTargetKindSchema,
        targetId: z.string().trim().min(1),
      })
    )
    .query(async ({ input }) => findHeartbeatRoutineConfig(input.targetKind, input.targetId)),

  listViews: protectedProcedure
    .input(
      z
        .object({
          entityKind: workViewEntityKindSchema.optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const views = await listWorkViews({
        ownerUserId: userId,
        entityKind: input?.entityKind,
        scope: 'user',
        limit: 100,
      })
      return views.map(presentWorkView)
    }),

  upsertView: protectedProcedure
    .input(
      z.object({
        viewId: z.string().trim().optional(),
        view: z.discriminatedUnion('entityKind', [goalViewSchema, ticketViewSchema]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const filtersJson = JSON.stringify(input.view.filters)
      const sortJson = JSON.stringify(input.view.filters.sort ?? null)

      if (input.viewId) {
        const existing = await findWorkViewById(input.viewId)
        if (!existing || existing.owner_user_id !== userId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'View not found.' })
        }

        const updated = await updateWorkView(input.viewId, {
          name: input.view.name,
          filters_json: filtersJson,
          sort_json: sortJson,
          group_by: input.view.groupBy ?? null,
        })
        if (!updated) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update view.' })
        }
        return presentWorkView(updated)
      }

      const created = await createWorkView({
        owner_user_id: userId,
        scope: 'user',
        entity_kind: input.view.entityKind,
        name: input.view.name,
        filters_json: filtersJson,
        sort_json: sortJson,
        group_by: input.view.groupBy ?? null,
      })
      return presentWorkView(created)
    }),

  deleteView: protectedProcedure
    .input(z.object({ viewId: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const removed = await deleteWorkView(input.viewId, userId)
      if (!removed) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'View not found.' })
      }
      return { ok: true }
    }),

  listGoals: protectedProcedure.input(goalListInputSchema.optional()).query(async ({ input }) => {
    const goals = await listGoals({
      statuses: input?.statuses,
      q: input?.q,
      ownerKind: input?.ownerKind,
      ownerRef: input?.ownerRef,
      teamId: input?.teamId,
      initiativeId: input?.initiativeId,
      includeArchived: input?.includeArchived,
      limit: input?.limit,
      sortBy: input?.sort?.field,
      sortDirection: input?.sort?.direction,
    })
    const rows = await enrichGoals(goals)
    return input?.staleOnly ? rows.filter((goal) => goal.isStale) : rows
  }),

  listInitiatives: protectedProcedure
    .input(
      z
        .object({
          statuses: z.array(goalStatusSchema).optional(),
          includeArchived: z.boolean().default(false),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb()
      const initiatives = await listInitiatives({
        statuses: input?.statuses,
        includeArchived: input?.includeArchived,
        limit: 200,
        sortBy: 'title',
        sortDirection: 'asc',
      })
      const initiativeIds = initiatives.map((initiative) => initiative.id)
      const [goals, childInitiatives] = await Promise.all([
        initiativeIds.length > 0
          ? db
              .selectFrom('goals')
              .select(['initiative_id', 'id', 'status'])
              .where('initiative_id', 'in', initiativeIds)
              .where('archived_at', 'is', null)
              .execute()
          : Promise.resolve([]),
        initiativeIds.length > 0
          ? db
              .selectFrom('initiatives')
              .select(['parent_initiative_id'])
              .where('parent_initiative_id', 'in', initiativeIds)
              .where('archived_at', 'is', null)
              .execute()
          : Promise.resolve([]),
      ])

      const goalCounts = new Map<string, number>()
      const activeGoalCounts = new Map<string, number>()
      for (const goal of goals) {
        if (!goal.initiative_id) continue
        goalCounts.set(goal.initiative_id, (goalCounts.get(goal.initiative_id) ?? 0) + 1)
        if (goal.status !== 'done' && goal.status !== 'archived') {
          activeGoalCounts.set(
            goal.initiative_id,
            (activeGoalCounts.get(goal.initiative_id) ?? 0) + 1
          )
        }
      }

      const childCounts = new Map<string, number>()
      for (const child of childInitiatives) {
        if (!child.parent_initiative_id) continue
        childCounts.set(
          child.parent_initiative_id,
          (childCounts.get(child.parent_initiative_id) ?? 0) + 1
        )
      }

      return initiatives.map((initiative) => ({
        id: initiative.id,
        parentInitiativeId: initiative.parent_initiative_id,
        title: initiative.title,
        description: initiative.description,
        status: initiative.status,
        teamId: initiative.team_id,
        targetLabel: initiative.target_label,
        goalCount: goalCounts.get(initiative.id) ?? 0,
        activeGoalCount: activeGoalCounts.get(initiative.id) ?? 0,
        childInitiativeCount: childCounts.get(initiative.id) ?? 0,
      }))
    }),

  getGoal: protectedProcedure
    .input(z.object({ goalId: z.string().min(1) }))
    .query(async ({ input }) => {
      const goal = await findGoalById(input.goalId)
      if (!goal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found.' })
      }

      const goalRow = requireFirst(await enrichGoals([goal]), 'goal')
      const [childGoals, tickets, updates] = await Promise.all([
        listGoals({ parentGoalId: goal.id, includeArchived: false }),
        listTickets({ goalId: goal.id, includeArchived: false }),
        listWorkUpdates({ goalId: goal.id, limit: 20 }),
      ])

      const ticketRows = await enrichTickets(tickets)
      const ticketReceiptSummaries = await Promise.all(
        ticketRows.map(async (ticket) => ({
          ticketId: ticket.id,
          summary: await buildTicketReceiptSummary(ticket.id),
        }))
      )

      return {
        ...goalRow,
        childGoals: await enrichGoals(childGoals),
        tickets: ticketRows.map((ticket) => ({
          ...ticket,
          receiptSummary:
            ticketReceiptSummaries.find((entry) => entry.ticketId === ticket.id)?.summary ?? null,
        })),
        updates,
        rollup: {
          totalCostUsd: ticketReceiptSummaries.reduce(
            (sum, entry) => sum + entry.summary.totalCostUsd,
            0
          ),
          totalWorkItems: ticketReceiptSummaries.reduce(
            (sum, entry) => sum + entry.summary.workItems.length,
            0
          ),
          totalJobs: ticketReceiptSummaries.reduce(
            (sum, entry) => sum + entry.summary.jobs.length,
            0
          ),
        },
      }
    }),

  createGoal: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(200),
        outcome: z.string().trim().min(1).max(4000),
        initiativeId: z.string().trim().optional().nullable(),
        parentGoalId: z.string().trim().optional().nullable(),
        ownerKind: actorKindSchema.optional().nullable(),
        ownerRef: z.string().trim().optional().nullable(),
        teamId: z.string().trim().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const goal = await createGoal({
        initiative_id: input.initiativeId ?? null,
        parent_goal_id: input.parentGoalId ?? null,
        title: input.title,
        outcome: input.outcome,
        status: 'draft',
        owner_kind: input.ownerKind ?? null,
        owner_ref: input.ownerRef ?? null,
        team_id: input.teamId ?? null,
        created_by_user_id: userId,
        archived_at: null,
      })

      await createWorkUpdate({
        goal_id: goal.id,
        ticket_id: null,
        team_id: goal.team_id,
        author_kind: 'user',
        author_ref: userId,
        kind: 'note',
        body: `Created goal "${goal.title}".`,
        metadata_json: null,
      })

      return requireFirst(await enrichGoals([goal]), 'goal')
    }),

  updateGoal: protectedProcedure
    .input(
      z.object({
        goalId: z.string().min(1),
        patch: z.object({
          title: z.string().trim().min(1).max(200).optional(),
          outcome: z.string().trim().min(1).max(4000).optional(),
          status: goalStatusSchema.optional(),
          initiativeId: z.string().trim().optional().nullable(),
          ownerKind: actorKindSchema.optional().nullable(),
          ownerRef: z.string().trim().optional().nullable(),
          teamId: z.string().trim().optional().nullable(),
          parentGoalId: z.string().trim().optional().nullable(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const existing = await findGoalById(input.goalId)
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found.' })
      }

      const updated = await updateGoal(input.goalId, {
        initiative_id:
          input.patch.initiativeId === undefined
            ? existing.initiative_id
            : (input.patch.initiativeId ?? null),
        title: input.patch.title ?? existing.title,
        outcome: input.patch.outcome ?? existing.outcome,
        status: input.patch.status ?? existing.status,
        owner_kind:
          input.patch.ownerKind === undefined
            ? existing.owner_kind
            : (input.patch.ownerKind ?? null),
        owner_ref:
          input.patch.ownerRef === undefined ? existing.owner_ref : (input.patch.ownerRef ?? null),
        team_id: input.patch.teamId === undefined ? existing.team_id : (input.patch.teamId ?? null),
        parent_goal_id:
          input.patch.parentGoalId === undefined
            ? existing.parent_goal_id
            : (input.patch.parentGoalId ?? null),
        archived_at:
          input.patch.status === 'archived'
            ? (existing.archived_at ?? now())
            : input.patch.status && existing.status === 'archived'
              ? null
              : existing.archived_at,
      })

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found.' })
      }

      if (input.patch.status && input.patch.status !== existing.status) {
        await createWorkUpdate({
          goal_id: updated.id,
          ticket_id: null,
          team_id: null,
          author_kind: 'user',
          author_ref: userId,
          kind: 'status',
          body: `Status changed from ${existing.status} to ${updated.status}.`,
          metadata_json: null,
        })
      }

      const ownerChanged =
        input.patch.ownerKind !== undefined &&
        (updated.owner_kind !== existing.owner_kind || updated.owner_ref !== existing.owner_ref)

      if (ownerChanged) {
        await createWorkUpdate({
          goal_id: updated.id,
          ticket_id: null,
          team_id: updated.team_id,
          author_kind: 'user',
          author_ref: userId,
          kind: 'note',
          body: `Owner changed from ${existing.owner_kind ?? 'none'}:${existing.owner_ref ?? 'none'} to ${updated.owner_kind ?? 'none'}:${updated.owner_ref ?? 'none'}.`,
          metadata_json: null,
        })
      }

      const teamChanged = input.patch.teamId !== undefined && updated.team_id !== existing.team_id

      if (teamChanged) {
        await createWorkUpdate({
          goal_id: updated.id,
          ticket_id: null,
          team_id: updated.team_id,
          author_kind: 'user',
          author_ref: userId,
          kind: 'note',
          body: `Team changed from ${existing.team_id ?? 'none'} to ${updated.team_id ?? 'none'}.`,
          metadata_json: null,
        })
      }

      return requireFirst(await enrichGoals([updated]), 'goal')
    }),

  listTickets: protectedProcedure
    .input(ticketListInputSchema.optional())
    .query(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const db = getDb()
      const scope = input?.scope ?? 'all'
      const staleBefore = input?.staleOnly ? now() - WORK_TICKET_STALE_AFTER_SECONDS : undefined
      const teamMemberships =
        scope === 'my_team'
          ? await db
              .selectFrom('team_members')
              .select(['team_id'])
              .where('user_id', '=', userId)
              .execute()
          : []

      let tickets = await listTickets({
        statuses: input?.statuses ?? ['inbox', 'ready', 'in_progress', 'blocked', 'done'],
        q: input?.q,
        goalId: input?.goalId,
        assigneeKind:
          scope === 'mine' ? 'user' : scope === 'my_team' ? 'team' : input?.assigneeKind,
        assigneeRef: scope === 'mine' ? userId : scope === 'all' ? input?.assigneeRef : undefined,
        assigneeRefs:
          scope === 'my_team' ? teamMemberships.map((membership) => membership.team_id) : undefined,
        includeArchived: input?.includeArchived,
        limit: input?.limit ?? 100,
        staleBefore,
        sortBy: input?.sort?.field,
        sortDirection: input?.sort?.direction,
      })

      if (scope === 'my_team') {
        const teamIds = new Set(teamMemberships.map((membership) => membership.team_id))
        tickets = tickets.filter(
          (ticket) =>
            ticket.assignee_kind === 'team' &&
            ticket.assignee_ref &&
            teamIds.has(ticket.assignee_ref)
        )
      } else if (scope === 'unclaimed') {
        tickets = tickets.filter(
          (ticket) => !ticket.assignee_kind || ticket.assignee_kind === 'team'
        )
      }

      return enrichTickets(tickets)
    }),

  getTicket: protectedProcedure
    .input(z.object({ ticketId: z.string().min(1) }))
    .query(async ({ input }) => {
      const ticket = await findTicketById(input.ticketId)
      if (!ticket) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found.' })
      }

      const ticketRow = requireFirst(await enrichTickets([ticket]), 'ticket')
      const [updates, related, receiptSummary] = await Promise.all([
        listWorkUpdates({ ticketId: ticket.id, limit: 30 }),
        listRelatedTickets({
          text: `${ticket.title} ${ticket.body ?? ''}`,
          excludeTicketId: ticket.id,
          limit: 5,
        }),
        buildTicketReceiptSummary(ticket.id),
      ])

      return {
        ...ticketRow,
        updates,
        relatedTickets: await enrichTickets(related.map((entry) => entry.ticket)),
        relatedScores: related.map((entry) => ({ ticketId: entry.ticket.id, score: entry.score })),
        receiptSummary,
      }
    }),

  suggestRelated: protectedProcedure
    .input(
      z.object({
        text: z.string().trim().min(1).max(4000),
        excludeTicketId: z.string().trim().optional(),
      })
    )
    .query(async ({ input }) => {
      const related = await listRelatedTickets({
        text: input.text,
        excludeTicketId: input.excludeTicketId,
        limit: 6,
      })
      const tickets = await enrichTickets(related.map((entry) => entry.ticket))
      return tickets.map((ticket) => ({
        ...ticket,
        score: related.find((entry) => entry.ticket.id === ticket.id)?.score ?? 0,
      }))
    }),

  createTicket: protectedProcedure
    .input(
      z.object({
        goalId: z.string().trim().optional().nullable(),
        parentTicketId: z.string().trim().optional().nullable(),
        title: z.string().trim().min(1).max(200),
        body: z.string().trim().max(6000).optional().nullable(),
        status: ticketStatusSchema.default('inbox'),
        assigneeKind: actorKindSchema.optional().nullable(),
        assigneeRef: z.string().trim().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const ticket = await createTicket({
        goal_id: input.goalId ?? null,
        parent_ticket_id: input.parentTicketId ?? null,
        title: input.title,
        body: input.body ?? null,
        status: input.status,
        assignee_kind: input.assigneeKind ?? null,
        assignee_ref: input.assigneeRef ?? null,
        created_by_user_id: userId,
        claimed_by_kind: null,
        claimed_by_ref: null,
        claimed_at: null,
        archived_at: null,
      })

      await createWorkUpdate({
        goal_id: ticket.goal_id,
        ticket_id: ticket.id,
        team_id: null,
        author_kind: 'user',
        author_ref: userId,
        kind: 'note',
        body: `Created ticket "${ticket.title}".`,
        metadata_json: null,
      })

      const row = requireFirst(await enrichTickets([ticket]), 'ticket')
      const related = await listRelatedTickets({
        text: `${ticket.title} ${ticket.body ?? ''}`,
        excludeTicketId: ticket.id,
        limit: 5,
      })

      return {
        ticket: row,
        relatedTickets: await enrichTickets(related.map((entry) => entry.ticket)),
      }
    }),

  claimTicket: protectedProcedure
    .input(
      z.object({
        ticketId: z.string().min(1),
        assigneeKind: z.enum(['user', 'agent']),
        assigneeRef: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const updated = await claimTicket(input.ticketId, {
        assigneeKind: input.assigneeKind,
        assigneeRef: input.assigneeRef,
        claimedByKind: 'user',
        claimedByRef: userId,
      })

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found.' })
      }

      await createWorkUpdate({
        goal_id: updated.goal_id,
        ticket_id: updated.id,
        team_id: null,
        author_kind: 'user',
        author_ref: userId,
        kind: 'status',
        body: `Claimed by ${input.assigneeKind} ${input.assigneeRef}.`,
        metadata_json: null,
      })

      return requireFirst(await enrichTickets([updated]), 'ticket')
    }),

  updateTicket: protectedProcedure
    .input(
      z.object({
        ticketId: z.string().min(1),
        patch: z.object({
          goalId: z.string().trim().optional().nullable(),
          parentTicketId: z.string().trim().optional().nullable(),
          title: z.string().trim().min(1).max(200).optional(),
          body: z.string().trim().max(6000).optional().nullable(),
          status: ticketStatusSchema.optional(),
          assigneeKind: actorKindSchema.optional().nullable(),
          assigneeRef: z.string().trim().optional().nullable(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const existing = await findTicketById(input.ticketId)
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found.' })
      }

      const nextStatus = input.patch.status ?? existing.status
      const assignment = resolveTicketAssignmentPatch({
        existing,
        patch: {
          assigneeKind: input.patch.assigneeKind,
          assigneeRef: input.patch.assigneeRef,
        },
        actorUserId: userId,
      })
      const updated = await updateTicket(input.ticketId, {
        goal_id: input.patch.goalId === undefined ? existing.goal_id : (input.patch.goalId ?? null),
        parent_ticket_id:
          input.patch.parentTicketId === undefined
            ? existing.parent_ticket_id
            : (input.patch.parentTicketId ?? null),
        title: input.patch.title ?? existing.title,
        body: input.patch.body === undefined ? existing.body : (input.patch.body ?? null),
        status: nextStatus,
        assignee_kind: assignment.assigneeKind,
        assignee_ref: assignment.assigneeRef,
        claimed_by_kind: assignment.claimedByKind,
        claimed_by_ref: assignment.claimedByRef,
        claimed_at: assignment.claimedAt,
        archived_at:
          nextStatus === 'canceled'
            ? (existing.archived_at ?? now())
            : nextStatus !== 'canceled' && existing.status === 'canceled'
              ? null
              : existing.archived_at,
      })

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found.' })
      }

      if (input.patch.status && input.patch.status !== existing.status) {
        await createWorkUpdate({
          goal_id: updated.goal_id,
          ticket_id: updated.id,
          team_id: null,
          author_kind: 'user',
          author_ref: userId,
          kind: 'status',
          body: `Status changed from ${existing.status} to ${updated.status}.`,
          metadata_json: null,
        })
      }

      const assignmentChanged =
        assignment.assigneeKind !== existing.assignee_kind ||
        assignment.assigneeRef !== existing.assignee_ref

      if (assignmentChanged) {
        const label = assignment.assigneeKind
          ? `${assignment.assigneeKind} ${assignment.assigneeRef}`
          : 'unassigned'
        await createWorkUpdate({
          goal_id: updated.goal_id,
          ticket_id: updated.id,
          team_id: null,
          author_kind: 'user',
          author_ref: userId,
          kind: 'note',
          body: `Assigned to ${label}.`,
          metadata_json: null,
        })
      }

      return requireFirst(await enrichTickets([updated]), 'ticket')
    }),

  bulkUpdateTickets: protectedProcedure
    .input(
      z.object({
        ticketIds: z.array(z.string().trim().min(1)).min(1).max(100),
        patch: z.object({
          status: ticketStatusSchema.optional(),
          assigneeKind: actorKindSchema.optional().nullable(),
          assigneeRef: z.string().trim().optional().nullable(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const db = getDb()
      const ticketIds = [...new Set(input.ticketIds)]
      const existing = await db
        .selectFrom('tickets')
        .selectAll()
        .where('id', 'in', ticketIds)
        .execute()

      if (existing.length !== ticketIds.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'One or more tickets were not found.' })
      }

      const results = []
      for (const ticket of existing) {
        const nextStatus = input.patch.status ?? ticket.status
        const assignment = resolveTicketAssignmentPatch({
          existing: ticket,
          patch: {
            assigneeKind: input.patch.assigneeKind,
            assigneeRef: input.patch.assigneeRef,
          },
          actorUserId: userId,
        })

        const updated = await updateTicket(ticket.id, {
          goal_id: ticket.goal_id,
          title: ticket.title,
          body: ticket.body,
          status: nextStatus,
          assignee_kind: assignment.assigneeKind,
          assignee_ref: assignment.assigneeRef,
          claimed_by_kind: assignment.claimedByKind,
          claimed_by_ref: assignment.claimedByRef,
          claimed_at: assignment.claimedAt,
          archived_at:
            nextStatus === 'canceled'
              ? (ticket.archived_at ?? now())
              : nextStatus !== 'canceled' && ticket.status === 'canceled'
                ? null
                : ticket.archived_at,
        })

        if (!updated) continue

        const messages: string[] = []
        if (input.patch.status && input.patch.status !== ticket.status) {
          messages.push(`Status changed from ${ticket.status} to ${updated.status}.`)
        }
        const assignmentChanged =
          assignment.assigneeKind !== ticket.assignee_kind ||
          assignment.assigneeRef !== ticket.assignee_ref
        if (assignmentChanged) {
          const label = assignment.assigneeKind
            ? `${assignment.assigneeKind} ${assignment.assigneeRef}`
            : 'unassigned'
          messages.push(`Assigned to ${label}.`)
        }

        for (const body of messages) {
          await createWorkUpdate({
            goal_id: updated.goal_id,
            ticket_id: updated.id,
            team_id: null,
            author_kind: 'user',
            author_ref: userId,
            kind: body.startsWith('Status changed') ? 'status' : 'note',
            body,
            metadata_json: null,
          })
        }

        results.push(updated)
      }

      return {
        updatedCount: results.length,
        tickets: await enrichTickets(results),
      }
    }),

  postWorkUpdate: protectedProcedure
    .input(
      z.object({
        goalId: z.string().trim().optional().nullable(),
        ticketId: z.string().trim().optional().nullable(),
        teamId: z.string().trim().optional().nullable(),
        kind: z.enum(['note', 'status', 'heartbeat']).default('note'),
        body: z.string().trim().min(1).max(4000),
        metadataJson: z.string().trim().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      if (!input.goalId && !input.ticketId && !input.teamId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A work update must target a goal, ticket, or team.',
        })
      }

      return createWorkUpdate({
        goal_id: input.goalId ?? null,
        ticket_id: input.ticketId ?? null,
        team_id: input.teamId ?? null,
        author_kind: 'user',
        author_ref: userId,
        kind: input.kind,
        body: input.body,
        metadata_json: input.metadataJson ?? null,
      })
    }),

  upsertHeartbeat: protectedProcedure
    .input(
      z.object({
        targetKind: heartbeatTargetKindSchema,
        targetId: z.string().trim().min(1),
        agentId: z.string().trim().min(1),
        cronExpr: z.string().trim().min(1),
        timezone: z.string().trim().min(1),
        enabled: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const db = getDb()
      const agent = await db
        .selectFrom('agents')
        .select(['id', 'name'])
        .where('id', '=', input.agentId)
        .executeTakeFirst()

      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found.' })
      }

      const sessionKey = buildHeartbeatSessionKey(input.targetKind, input.targetId)
      let targetLabel = ''
      let sessionTitle = ''
      let actionPrompt = ''
      let goalId: string | null = null
      let teamId: string | null = null

      if (input.targetKind === 'goal') {
        const goal = await findGoalById(input.targetId)
        if (!goal) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found.' })
        }
        targetLabel = goal.title
        sessionTitle = `Goal heartbeat · ${goal.title}`
        actionPrompt = buildGoalHeartbeatPrompt(goal)
        goalId = goal.id
      } else {
        const team = await db
          .selectFrom('teams')
          .select(['id', 'name', 'description'])
          .where('id', '=', input.targetId)
          .executeTakeFirst()

        if (!team) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found.' })
        }

        targetLabel = team.name
        sessionTitle = `Team heartbeat · ${team.name}`
        actionPrompt = buildTeamHeartbeatPrompt(team)
        teamId = team.id
      }

      await ensureHeartbeatSession({
        sessionKey,
        title: sessionTitle,
        ownerUserId: userId,
        agentId: input.agentId,
      })

      const nextRunAt = input.enabled ? validateCronSchedule(input.cronExpr, input.timezone) : null
      const existing = await db
        .selectFrom('routines')
        .selectAll()
        .where('target_session_key', '=', sessionKey)
        .where('archived_at', 'is', null)
        .orderBy('created_at', 'desc')
        .executeTakeFirst()

      const name = `${input.targetKind === 'goal' ? 'Goal' : 'Team'} Heartbeat · ${targetLabel}`
      const description =
        input.targetKind === 'goal'
          ? `Recurring heartbeat for goal ${targetLabel}.`
          : `Recurring heartbeat for team ${targetLabel}.`
      const routinePatch = {
        agent_id: input.agentId,
        name,
        description,
        enabled: input.enabled ? 1 : 0,
        trigger_kind: 'cron',
        cron_expr: input.cronExpr,
        timezone: input.timezone,
        rule_json: JSON.stringify(getAlwaysTrueRuleForEnvelope()),
        condition_probe: null,
        condition_config: null,
        target_plugin_instance_id: null,
        target_session_key: sessionKey,
        target_response_context: buildHeartbeatContext(input.targetKind, input.targetId),
        action_prompt: actionPrompt,
        next_run_at: nextRunAt,
        archived_at: null,
      } as const

      const routine = existing
        ? await updateRoutine(existing.id, routinePatch)
        : await createRoutine({
            ...routinePatch,
            last_evaluated_at: null,
            last_fired_at: null,
            last_status: null,
            created_by_kind: 'admin',
            created_by_ref: userId,
          })

      if (!routine) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to save heartbeat routine.',
        })
      }

      await createWorkUpdate({
        goal_id: goalId,
        ticket_id: null,
        team_id: teamId,
        author_kind: 'user',
        author_ref: userId,
        kind: 'note',
        body: existing
          ? `Updated ${input.targetKind} heartbeat schedule for ${agent.name}.`
          : `Configured ${input.targetKind} heartbeat schedule for ${agent.name}.`,
        metadata_json: JSON.stringify({ routineId: routine.id }),
      })

      return requireFirst(
        [await findHeartbeatRoutineConfig(input.targetKind, input.targetId)],
        'heartbeat'
      )
    }),

  linkTicket: protectedProcedure
    .input(
      z.object({
        ticketId: z.string().min(1),
        kind: ticketLinkKindSchema,
        ref: z.string().trim().min(1),
        label: z.string().trim().optional().nullable(),
        metadataJson: z.string().trim().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const ticket = await findTicketById(input.ticketId)
      if (!ticket) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found.' })
      }

      if (input.kind === 'session') {
        const existing = await findTicketBySessionKey(input.ref)
        if (existing && existing.id !== ticket.id) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This session is already linked to another ticket.',
          })
        }
      }

      if (input.kind === 'work_item') {
        const existing = await findTicketByWorkItemId(input.ref)
        if (existing && existing.id !== ticket.id) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This run is already linked to another ticket.',
          })
        }
      }

      const link = await createTicketLink({
        ticket_id: input.ticketId,
        kind: input.kind,
        ref: input.ref,
        label: input.label ?? null,
        metadata_json: input.metadataJson ?? null,
        created_by_kind: 'user',
        created_by_ref: userId,
      })

      await createWorkUpdate({
        goal_id: ticket.goal_id,
        ticket_id: ticket.id,
        team_id: null,
        author_kind: 'user',
        author_ref: userId,
        kind: 'note',
        body: `Linked ${input.kind} receipt ${input.ref}.`,
        metadata_json: null,
      })

      return link
    }),

  promoteSession: protectedProcedure
    .input(
      z.object({
        sessionKey: z.string().trim().min(1),
        goalId: z.string().trim().optional().nullable(),
        title: z.string().trim().max(200).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const db = getDb()
      const session = await db
        .selectFrom('app_sessions')
        .select(['session_key', 'title', 'primary_agent_id'])
        .where('session_key', '=', input.sessionKey)
        .where('owner_user_id', '=', userId)
        .executeTakeFirst()

      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found.' })
      }

      const existing = await findTicketBySessionKey(input.sessionKey)
      if (existing) {
        return {
          ticket: requireFirst(await enrichTickets([existing]), 'ticket'),
          created: false,
        }
      }

      const latestWorkItem = await db
        .selectFrom('work_items')
        .select(['title'])
        .where('session_key', '=', input.sessionKey)
        .orderBy('created_at', 'desc')
        .executeTakeFirst()

      const ticket = await createTicket({
        goal_id: input.goalId ?? null,
        title: input.title?.trim() || session.title || latestWorkItem?.title || 'Promoted session',
        body: `Promoted from session ${input.sessionKey}.`,
        status: 'in_progress',
        assignee_kind: 'agent',
        assignee_ref: session.primary_agent_id,
        created_by_user_id: userId,
        claimed_by_kind: 'user',
        claimed_by_ref: userId,
        claimed_at: now(),
        archived_at: null,
      })

      await createTicketLink({
        ticket_id: ticket.id,
        kind: 'session',
        ref: input.sessionKey,
        label: session.title ?? null,
        metadata_json: null,
        created_by_kind: 'user',
        created_by_ref: userId,
      })

      await createWorkUpdate({
        goal_id: ticket.goal_id,
        ticket_id: ticket.id,
        team_id: null,
        author_kind: 'user',
        author_ref: userId,
        kind: 'note',
        body: `Promoted untracked session ${input.sessionKey} into a ticket.`,
        metadata_json: null,
      })

      return {
        ticket: requireFirst(await enrichTickets([ticket]), 'ticket'),
        created: true,
      }
    }),
})
