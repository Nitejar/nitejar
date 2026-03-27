import { TRPCError } from '@trpc/server'
import { parseAgentConfig } from '@nitejar/agent/config'
import {
  addTicketParticipants,
  addAppSessionParticipants,
  claimTicket,
  createAttentionItem,
  createAppSession,
  createGoal,
  createRoutine,
  createTicketComment,
  createTicket,
  createTicketLink,
  createWorkView,
  createWorkUpdate,
  deleteWorkView,
  enqueueTicketAgentWork,
  findAppSessionByKey,
  findAgentById,
  findGoalById,
  findTicketById,
  findTicketBySessionKey,
  findTicketByWorkItemId,
  getAttentionSummary,
  findWorkViewById,
  getDb,
  listGoals,
  reorderGoal,
  reorderTicket,
  listGoalHealthSummaries,
  listAttentionItems,
  listAgentWorkloadRollups,
  listLinkedWorkItemsForTicket,
  listRelatedTickets,
  listTicketComments,
  listTicketRelations,
  listTicketLinksByTicket,
  listTicketParticipants,
  listTicketWorkloadRollups,
  listTickets,
  listUntrackedAppSessions,
  listWorkViews,
  listWorkUpdates,
  markAttentionItemsRead,
  resolveAttentionItemsForTargetOnTicket,
  sql,
  WORK_TICKET_STALE_AFTER_SECONDS,
  updateRoutine,
  updateGoal,
  updateTicket,
  updateWorkView,
  type WorkItem,
} from '@nitejar/database'
import { z } from 'zod'
import { validateCronSchedule } from '../services/routines/cron'
import { getAlwaysTrueRuleForEnvelope } from '../services/routines/rules'
import { protectedProcedure, router } from '../trpc'
import { buildGoalHeartbeatPrompt } from './work-heartbeat'

const goalStatusSchema = z.enum(['draft', 'active', 'at_risk', 'blocked', 'done', 'archived'])
const progressSourceSchema = z.enum([
  'ticket_rollup',
  'sub_goal_rollup',
  'number',
  'currency',
  'percentage',
  'boolean',
])
const ticketStatusSchema = z.enum(['inbox', 'ready', 'in_progress', 'blocked', 'done', 'canceled'])
const actorKindSchema = z.enum(['user', 'agent'])
const attentionStateSchema = z.enum(['all', 'open', 'resolved'])
const ticketCommentKindSchema = z.enum([
  'comment',
  'question',
  'decision_needed',
  'review_requested',
  'blocked',
])
const ticketLinkKindSchema = z.enum(['session', 'work_item', 'external'])
const heartbeatTargetKindSchema = z.enum(['goal'])
const workViewEntityKindSchema = z.enum(['goal', 'ticket'])
const sortDirectionSchema = z.enum(['asc', 'desc'])
const goalSortFieldSchema = z.enum(['updated_at', 'created_at', 'title', 'status'])
const ticketSortFieldSchema = z.enum(['updated_at', 'created_at', 'title', 'status'])

const goalListInputSchema = z.object({
  scope: z.enum(['mine', 'my_team', 'all']).default('all'),
  statuses: z.array(goalStatusSchema).optional(),
  q: z.string().trim().optional(),
  ownerKind: actorKindSchema.optional(),
  ownerRef: z.string().trim().optional(),
  teamId: z.string().trim().optional(),
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

export type TicketTreeNode = {
  id: string
  title: string
  status: string
  assignee: ResolvedActor
  children: TicketTreeNode[]
}

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
    assigneeKind?: 'user' | 'agent' | null
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
      forked_from_session_key: null,
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

  let agentId: string | null = routine.agent_id
  let agentName: string | null = null
  let agentHandle: string | null = null
  let agentTitle: string | null = null
  let goalOwnershipResolved = false

  if (targetKind === 'goal') {
    const goal = await findGoalById(targetId)
    if (goal?.owner_kind === 'agent' && goal.owner_ref) {
      goalOwnershipResolved = true
      const ownerAgent = await db
        .selectFrom('agents')
        .leftJoin('agent_role_assignments', 'agent_role_assignments.agent_id', 'agents.id')
        .leftJoin('roles', 'roles.id', 'agent_role_assignments.role_id')
        .select(['agents.id', 'agents.name', 'agents.handle', 'roles.name as role_name'])
        .where('agents.id', '=', goal.owner_ref)
        .executeTakeFirst()

      if (ownerAgent) {
        agentId = ownerAgent.id
        agentName = ownerAgent.name
        agentHandle = ownerAgent.handle
        agentTitle = ownerAgent.role_name ?? null
      }
    } else if (goal) {
      goalOwnershipResolved = true
      agentId = null
    }
  }

  if (!goalOwnershipResolved && !agentName && agentId) {
    const agent = await db
      .selectFrom('agents')
      .leftJoin('agent_role_assignments', 'agent_role_assignments.agent_id', 'agents.id')
      .leftJoin('roles', 'roles.id', 'agent_role_assignments.role_id')
      .select(['agents.id', 'agents.name', 'agents.handle', 'roles.name as role_name'])
      .where('agents.id', '=', agentId)
      .executeTakeFirst()

    agentId = agent?.id ?? agentId
    agentName = agent?.name ?? null
    agentHandle = agent?.handle ?? null
    agentTitle = agent?.role_name ?? null
  }

  return {
    id: routine.id,
    sessionKey,
    agentId,
    agentName,
    agentHandle,
    agentTitle,
    enabled: routine.enabled === 1,
    cronExpr: routine.cron_expr,
    timezone: routine.timezone,
    nextRunAt: routine.next_run_at,
    lastEvaluatedAt: routine.last_evaluated_at,
    lastFiredAt: routine.last_fired_at,
    lastStatus: routine.last_status,
  }
}

type GoalHeartbeatOwner = {
  agentId: string
  agentName: string
  agentTitle: string | null
}

async function findGoalHeartbeatOwner(goalId: string): Promise<GoalHeartbeatOwner | null> {
  const db = getDb()
  const goal = await findGoalById(goalId)
  if (!goal) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found.' })
  }

  if (goal.owner_kind !== 'agent' || !goal.owner_ref) {
    return null
  }

  const agent = await db
    .selectFrom('agents')
    .leftJoin('agent_role_assignments', 'agent_role_assignments.agent_id', 'agents.id')
    .leftJoin('roles', 'roles.id', 'agent_role_assignments.role_id')
    .select(['agents.id', 'agents.name', 'roles.name as role_name'])
    .where('agents.id', '=', goal.owner_ref)
    .executeTakeFirst()

  if (!agent) {
    return null
  }

  return {
    agentId: agent.id,
    agentName: agent.name,
    agentTitle: agent.role_name ?? null,
  }
}

async function buildGoalHeartbeatRoutineSpec(input: {
  goalId: string
  ownerAgent: GoalHeartbeatOwner
}) {
  const db = getDb()
  const goal = await findGoalById(input.goalId)
  if (!goal) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found.' })
  }

  const goalRow = requireFirst(await enrichGoals([goal]), 'goal')
  const allGoals = await listGoals({ includeArchived: false })

  const goalsByParent = new Map<string, typeof allGoals>()
  for (const row of allGoals) {
    if (!row.parent_goal_id) continue
    const siblings = goalsByParent.get(row.parent_goal_id) ?? []
    siblings.push(row)
    goalsByParent.set(row.parent_goal_id, siblings)
  }

  const descendantGoals: typeof allGoals = []
  const collectDescendants = (parentGoalId: string) => {
    const children = [...(goalsByParent.get(parentGoalId) ?? [])].sort(
      (left, right) => left.sort_order - right.sort_order
    )
    for (const child of children) {
      descendantGoals.push(child)
      collectDescendants(child.id)
    }
  }

  collectDescendants(goal.id)

  const enrichedDescendants = await enrichGoals(descendantGoals)
  const descendantSessionKeys = enrichedDescendants.map((descendant) =>
    buildHeartbeatSessionKey('goal', descendant.id)
  )
  const activeDescendantRoutines =
    descendantSessionKeys.length > 0
      ? await db
          .selectFrom('routines')
          .select(['target_session_key'])
          .where('target_session_key', 'in', descendantSessionKeys)
          .where('archived_at', 'is', null)
          .where('enabled', '=', 1)
          .execute()
      : []

  const activeSessionKeys = new Set(activeDescendantRoutines.map((row) => row.target_session_key))

  const actionPrompt = buildGoalHeartbeatPrompt({
    goalId: goal.id,
    title: goal.title,
    outcome: goal.outcome,
    assignedAgentName: input.ownerAgent.agentName,
    assignedAgentTitle: input.ownerAgent.agentTitle ?? null,
    goalOwnerLabel: goalRow.owner?.label ?? null,
    goalOwnerTitle: goalRow.owner?.kind === 'agent' ? (goalRow.owner.title ?? null) : null,
    descendants: enrichedDescendants.map((descendant) => ({
      id: descendant.id,
      title: descendant.title,
      outcome: descendant.outcome,
      ownerLabel: descendant.owner?.label ?? null,
      ownerTitle: descendant.owner?.kind === 'agent' ? (descendant.owner.title ?? null) : null,
      latestUpdate: descendant.latestUpdate?.body ?? null,
      hasActiveHeartbeat: activeSessionKeys.has(buildHeartbeatSessionKey('goal', descendant.id)),
    })),
  })

  return {
    goal,
    targetLabel: goal.title,
    sessionTitle: `Goal stewardship · ${goal.title}`,
    actionPrompt,
    ownerAgent: input.ownerAgent,
  }
}

async function syncGoalHeartbeatToOwner(input: {
  goalId: string
  userId: string
  ownerKind: string | null
  ownerRef: string | null
  teamId: string | null
}) {
  const db = getDb()
  const sessionKey = buildHeartbeatSessionKey('goal', input.goalId)
  const existing = await db
    .selectFrom('routines')
    .selectAll()
    .where('target_session_key', '=', sessionKey)
    .where('archived_at', 'is', null)
    .orderBy('created_at', 'desc')
    .executeTakeFirst()

  if (!existing) return

  if (input.ownerKind !== 'agent' || !input.ownerRef) {
    if (existing.enabled === 1) {
      await updateRoutine(existing.id, {
        enabled: 0,
        next_run_at: null,
      })

      await createWorkUpdate({
        goal_id: input.goalId,
        ticket_id: null,
        team_id: input.teamId,
        author_kind: 'system',
        author_ref: null,
        kind: 'note',
        body: 'Disabled goal stewardship because this goal no longer has an agent owner.',
        metadata_json: JSON.stringify({ routineId: existing.id }),
      })
    }
    return
  }

  const ownerAgent = await findGoalHeartbeatOwner(input.goalId)
  if (!ownerAgent) {
    return
  }

  const goalHeartbeat = await buildGoalHeartbeatRoutineSpec({
    goalId: input.goalId,
    ownerAgent,
  })

  await ensureHeartbeatSession({
    sessionKey,
    title: goalHeartbeat.sessionTitle,
    ownerUserId: input.userId,
    agentId: ownerAgent.agentId,
  })

  const nextRunAt =
    existing.enabled === 1
      ? validateCronSchedule(existing.cron_expr ?? '0 9 * * 1-5', existing.timezone ?? 'UTC')
      : null

  await updateRoutine(existing.id, {
    agent_id: ownerAgent.agentId,
    name: `Goal Stewardship · ${goalHeartbeat.targetLabel}`,
    description: `Recurring stewardship loop for goal ${goalHeartbeat.targetLabel}.`,
    action_prompt: goalHeartbeat.actionPrompt,
    next_run_at: nextRunAt,
    target_response_context: buildHeartbeatContext('goal', input.goalId),
  })
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
          .leftJoin('agent_role_assignments', 'agent_role_assignments.agent_id', 'agents.id')
          .leftJoin('roles', 'roles.id', 'agent_role_assignments.role_id')
          .select([
            'agents.id',
            'agents.name',
            'agents.handle',
            'agents.config',
            'roles.name as role_name',
          ])
          .where('agents.id', 'in', agentIds)
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
            title: agent.role_name ?? null,
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

function presentWorkUpdate(
  update: Awaited<ReturnType<typeof listWorkUpdates>>[number],
  resolved: Awaited<ReturnType<typeof resolveActors>>
) {
  return {
    ...update,
    source: update.author_kind === 'system' ? ('system' as const) : ('authored' as const),
    author: presentActor(update.author_kind, update.author_ref, resolved),
  }
}

type TicketCommentMetadata = {
  mentionAgentIds?: string[]
  mentionUserIds?: string[]
  mentionTokens?: string[]
}

function parseTicketCommentMetadata(value: string | null): TicketCommentMetadata {
  if (!value) return {}
  try {
    return (JSON.parse(value) as TicketCommentMetadata) ?? {}
  } catch {
    return {}
  }
}

function presentTicketComment(
  comment: Awaited<ReturnType<typeof listTicketComments>>[number],
  resolved: Awaited<ReturnType<typeof resolveActors>>
) {
  const metadata = parseTicketCommentMetadata(comment.metadata_json)
  const mentionedAgents = (metadata.mentionAgentIds ?? [])
    .map((agentId) => presentActor('agent', agentId, resolved))
    .filter((actor): actor is NonNullable<typeof actor> => actor !== null)
  const mentionedUsers = (metadata.mentionUserIds ?? [])
    .map((userId) => presentActor('user', userId, resolved))
    .filter((actor): actor is NonNullable<typeof actor> => actor !== null)

  return {
    ...comment,
    author: presentActor(comment.author_kind, comment.author_ref, resolved),
    mentions: [...mentionedAgents, ...mentionedUsers],
    mentionTokens: metadata.mentionTokens ?? [],
  }
}

function presentAttentionItem(
  item: Awaited<ReturnType<typeof listAttentionItems>>[number],
  resolved: Awaited<ReturnType<typeof resolveActors>>
) {
  return {
    ...item,
    target: presentActor(item.target_kind, item.target_ref, resolved),
  }
}

function presentInboxAttentionItem(input: {
  item: Awaited<ReturnType<typeof listAttentionItems>>[number]
  resolved: Awaited<ReturnType<typeof resolveActors>>
  ticket: Awaited<ReturnType<typeof enrichTickets>>[number] | null
  comment:
    | {
        id: string
        kind: string
        body: string
        created_at: number
        author_kind: string
        author_ref: string | null
      }
    | null
}) {
  const target = presentActor(input.item.target_kind, input.item.target_ref, input.resolved)
  const sourceAuthor = input.comment
    ? presentActor(input.comment.author_kind, input.comment.author_ref, input.resolved)
    : null

  return {
    id: input.item.id,
    targetKind: input.item.target_kind,
    targetRef: input.item.target_ref,
    sourceKind: input.item.source_kind,
    sourceRef: input.item.source_ref,
    ticketId: input.item.ticket_id,
    goalId: input.item.goal_id,
    status: input.item.status,
    title: input.item.title,
    body: input.item.body,
    metadataJson: input.item.metadata_json,
    createdAt: input.item.created_at,
    updatedAt: input.item.updated_at,
    readAt: input.item.read_at,
    readByKind: input.item.read_by_kind,
    readByRef: input.item.read_by_ref,
    resolvedAt: input.item.resolved_at,
    resolvedByKind: input.item.resolved_by_kind,
    resolvedByRef: input.item.resolved_by_ref,
    isUnread: input.item.read_at == null,
    target,
    ticket: input.ticket,
    goal: input.ticket?.goal ?? null,
    comment: input.comment
      ? {
          id: input.comment.id,
          kind: input.comment.kind,
          body: input.comment.body,
          createdAt: input.comment.created_at,
          author: sourceAuthor,
        }
      : null,
  }
}

async function enrichGoals(rows: Awaited<ReturnType<typeof listGoals>>) {
  if (rows.length === 0) return []
  const db = getDb()
  const goalIds = rows.map((row) => row.id)
  const parentGoalIds = [
    ...new Set(
      rows.map((row) => row.parent_goal_id).filter((goalId): goalId is string => !!goalId)
    ),
  ]
  const [tickets, updates, childGoals, parentGoals, actors, healthSummaries] = await Promise.all([
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
      .select([
        'id',
        'parent_goal_id',
        'progress_source',
        'progress_current',
        'progress_target',
        'status',
      ])
      .where('parent_goal_id', 'in', goalIds)
      .where('archived_at', 'is', null)
      .execute(),
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

  const parentGoalMap = new Map(parentGoals.map((goal) => [goal.id, goal]))
  const healthByGoal = new Map(healthSummaries.map((summary) => [summary.goal_id, summary]))

  // Build a map of child goals per parent for sub_goal_rollup computation
  const childGoalsByParent = new Map<
    string,
    Array<{
      id: string
      progress_source: string
      progress_current: number | null
      progress_target: number | null
      status: string
    }>
  >()
  for (const child of childGoals) {
    if (!child.parent_goal_id) continue
    const list = childGoalsByParent.get(child.parent_goal_id) ?? []
    list.push(child)
    childGoalsByParent.set(child.parent_goal_id, list)
  }

  return rows.map((row) => {
    const health = healthByGoal.get(row.id)
    const tc = ticketCounts.get(row.id) ?? {
      total: 0,
      inbox: 0,
      ready: 0,
      in_progress: 0,
      blocked: 0,
      done: 0,
    }

    // Compute progressPercent based on progress_source
    const source = row.progress_source ?? 'ticket_rollup'
    let progressPercent: number
    switch (source) {
      case 'ticket_rollup':
        progressPercent = tc.total > 0 ? (tc.done / tc.total) * 100 : 0
        break
      case 'sub_goal_rollup': {
        const children = childGoalsByParent.get(row.id) ?? []
        if (children.length === 0) {
          progressPercent = 0
        } else {
          const sum = children.reduce((acc, child) => {
            return acc + computeChildProgressPercent(child, ticketCounts)
          }, 0)
          progressPercent = sum / children.length
        }
        break
      }
      case 'number':
      case 'currency':
      case 'percentage':
        progressPercent =
          row.progress_target && row.progress_target > 0
            ? Math.min(100, Math.max(0, ((row.progress_current ?? 0) / row.progress_target) * 100))
            : 0
        break
      case 'boolean':
        progressPercent = (row.progress_current ?? 0) >= 1 ? 100 : 0
        break
      default:
        progressPercent = 0
    }

    return {
      id: row.id,
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
      progressSource: source,
      progressCurrent: row.progress_current,
      progressTarget: row.progress_target,
      progressUnit: row.progress_unit,
      progressPercent: Math.round(progressPercent * 100) / 100,
      owner: presentActor(row.owner_kind, row.owner_ref, actors),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActivityAt: health?.last_activity_at ?? row.updated_at,
      lastHeartbeatAt: health?.last_heartbeat_at ?? null,
      archivedAt: row.archived_at,
      sortOrder: row.sort_order,
      childGoalCount: childCounts.get(row.id) ?? 0,
      ticketCounts: tc,
      latestUpdate: latestUpdates.get(row.id) ?? null,
    }
  })
}

/**
 * Compute progress percent for a child goal (used in sub_goal_rollup).
 * This is a simplified version that handles all source types without
 * recursing into sub_goal_rollup children of children.
 */
function computeChildProgressPercent(
  child: {
    id: string
    progress_source: string
    progress_current: number | null
    progress_target: number | null
    status: string
  },
  ticketCounts: Map<string, { total: number; done: number }>
): number {
  const source = child.progress_source ?? 'ticket_rollup'
  switch (source) {
    case 'ticket_rollup': {
      const tc = ticketCounts.get(child.id)
      if (!tc || tc.total === 0) return 0
      return (tc.done / tc.total) * 100
    }
    case 'number':
    case 'currency':
    case 'percentage':
      return child.progress_target && child.progress_target > 0
        ? Math.min(100, Math.max(0, ((child.progress_current ?? 0) / child.progress_target) * 100))
        : 0
    case 'boolean':
      return (child.progress_current ?? 0) >= 1 ? 100 : 0
    case 'sub_goal_rollup':
      // For nested sub_goal_rollup, we'd need recursive fetching.
      // Use status as a proxy: done = 100, else 0.
      return child.status === 'done' ? 100 : 0
    default:
      return 0
  }
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

  const [goals, updates, links, relations, childTickets, parentTickets, actors] = await Promise.all(
    [
      goalIds.length > 0
        ? db
            .selectFrom('goals')
            .select(['id', 'title', 'status'])
            .where('id', 'in', goalIds)
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
    ]
  )

  const goalMap = new Map(goals.map((goal) => [goal.id, goal]))
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
          }
        : null,
    assignee: presentActor(row.assignee_kind, row.assignee_ref, actors),
    isUnclaimed: !row.assignee_kind,
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    sortOrder: row.sort_order,
    latestUpdate: latestUpdates.get(row.id) ?? null,
    links: linksByTicket.get(row.id) ?? [],
    blockedByCount: relationCountsByTicket.get(row.id)?.blockedByCount ?? 0,
    blockingCount: relationCountsByTicket.get(row.id)?.blockingCount ?? 0,
    relatedTicketCount: relationCountsByTicket.get(row.id)?.relatedCount ?? 0,
  }))
}

async function buildTicketReceiptSummary(ticketId: string) {
  const [links, linkedWorkItems, typedSessionWorkItems] = await Promise.all([
    listTicketLinksByTicket(ticketId),
    listLinkedWorkItemsForTicket(ticketId),
    listWorkItemsBySessionPrefix(`app:ticket:${ticketId}`),
  ])
  const workItems = dedupeWorkItemsById([...linkedWorkItems, ...typedSessionWorkItems])

  return buildReceiptSummaryFromWorkItems({
    links,
    workItems,
  })
}

function dedupeWorkItemsById(items: WorkItem[]): WorkItem[] {
  const seen = new Set<string>()
  const deduped: WorkItem[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    deduped.push(item)
  }
  return deduped
}

async function listWorkItemsBySessionPrefix(sessionPrefix: string): Promise<WorkItem[]> {
  const db = getDb()
  return db
    .selectFrom('work_items')
    .selectAll()
    .where('session_key', 'like', `${sessionPrefix}:%`)
    .orderBy('created_at', 'desc')
    .execute()
}

async function buildReceiptSummaryFromWorkItems(args: {
  links?: Awaited<ReturnType<typeof listTicketLinksByTicket>>
  workItems: WorkItem[]
}) {
  const db = getDb()
  const workItemIds = args.workItems.map((item) => item.id)
  const sessionKeys = [...new Set(args.workItems.map((item) => item.session_key))]

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
    links: (args.links ?? []).map((link) => ({
      id: link.id,
      kind: link.kind,
      ref: link.ref,
      label: link.label,
      metadataJson: link.metadata_json,
      createdAt: link.created_at,
    })),
    workItems: args.workItems.map((item) => ({
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

function mergeReceiptSummaryRollups(
  summaries: Array<{
    totalCostUsd: number
    workItems: Array<{ id: string }>
    jobs: Array<{ id: string }>
  }>
) {
  const workItemIds = new Set<string>()
  const jobIds = new Set<string>()
  let totalCostUsd = 0

  for (const summary of summaries) {
    totalCostUsd += summary.totalCostUsd
    for (const workItem of summary.workItems) {
      workItemIds.add(workItem.id)
    }
    for (const job of summary.jobs) {
      jobIds.add(job.id)
    }
  }

  return {
    totalCostUsd,
    totalWorkItems: workItemIds.size,
    totalJobs: jobIds.size,
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
      attentionItems,
      attentionSummary,
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
      listAttentionItems({
        targetKind: 'user',
        targetRef: userId,
        statuses: ['open'],
        limit: 20,
      }),
      getAttentionSummary({ targetKind: 'user', targetRef: userId }),
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
    const attentionTicketIds = [...new Set(attentionItems.map((item) => item.ticket_id).filter(Boolean))]
    const attentionTickets =
      attentionTicketIds.length > 0
        ? await enrichTickets(
            (
              await db
                .selectFrom('tickets')
                .selectAll()
                .where('id', 'in', attentionTicketIds)
                .execute()
            ).filter(Boolean)
          )
        : []
    const attentionTicketById = new Map(attentionTickets.map((ticket) => [ticket.id, ticket]))
    const workloadActors = await resolveActors(
      workloadRollups.map((entry) => ({
        kind: entry.assignee_kind,
        ref: entry.assignee_ref,
      }))
    )

    const myTeamIds = new Set(teamMemberships.map((membership) => membership.team_id))
    const myTeamAgentRows =
      myTeamIds.size > 0
        ? await db
            .selectFrom('agent_teams')
            .select(['agent_id'])
            .where('team_id', 'in', [...myTeamIds])
            .execute()
        : []
    const myTeamAgentIds = new Set(myTeamAgentRows.map((row) => row.agent_id))
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
      (ticket) =>
        ticket.assignee?.kind === 'agent' &&
        ticket.assignee.ref &&
        myTeamAgentIds.has(ticket.assignee.ref)
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
      currentUserId: userId,
      myTeamIds: Array.from(myTeamIds),
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
      attentionSummary,
      attentionItems: attentionItems.map((item) => ({
        ...item,
        ticket: item.ticket_id ? (attentionTicketById.get(item.ticket_id) ?? null) : null,
      })),
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

  getInboxSummary: protectedProcedure.query(async ({ ctx }) => {
    const userId = requireUserId(ctx.session)
    return getAttentionSummary({ targetKind: 'user', targetRef: userId })
  }),

  listInboxAttention: protectedProcedure
    .input(
      z
        .object({
          state: attentionStateSchema.default('all'),
          unreadOnly: z.boolean().default(false),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const db = getDb()
      const state = input?.state ?? 'all'
      const unreadOnly = input?.unreadOnly ?? false
      const statuses = state === 'all' ? undefined : [state]

      const [summary, items, totalRow] = await Promise.all([
        getAttentionSummary({ targetKind: 'user', targetRef: userId }),
        listAttentionItems({
          targetKind: 'user',
          targetRef: userId,
          statuses,
          unreadOnly,
          limit: input?.limit ?? 50,
          offset: input?.offset ?? 0,
        }),
        (async () => {
          let query = db
            .selectFrom('attention_items')
            .select((eb) => eb.fn.countAll<number>().as('count'))
            .where('target_kind', '=', 'user')
            .where('target_ref', '=', userId)
          if (statuses && statuses.length > 0) {
            query = query.where('status', 'in', statuses)
          }
          if (unreadOnly) {
            query = query.where('read_at', 'is', null)
          }
          return query.executeTakeFirst()
        })(),
      ])

      const ticketIds = [...new Set(items.map((item) => item.ticket_id).filter(Boolean))]
      const commentIds = [
        ...new Set(
          items
            .filter((item) => item.source_kind === 'ticket_comment' && item.source_ref)
            .map((item) => item.source_ref)
        ),
      ]

      const [tickets, comments] = await Promise.all([
        ticketIds.length > 0
          ? enrichTickets(
              (
                await db
                  .selectFrom('tickets')
                  .selectAll()
                  .where('id', 'in', ticketIds)
                  .execute()
              ).filter(Boolean)
            )
          : Promise.resolve([]),
        commentIds.length > 0
          ? db
              .selectFrom('ticket_comments')
              .select(['id', 'kind', 'body', 'created_at', 'author_kind', 'author_ref'])
              .where('id', 'in', commentIds)
              .execute()
          : Promise.resolve([]),
      ])

      const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]))
      const commentById = new Map(comments.map((comment) => [comment.id, comment]))
      const actors = await resolveActors([
        ...items.map((item) => ({ kind: item.target_kind, ref: item.target_ref })),
        ...comments.map((comment) => ({ kind: comment.author_kind, ref: comment.author_ref })),
      ])

      return {
        total: Number(totalRow?.count ?? 0),
        summary,
        items: items.map((item) =>
          presentInboxAttentionItem({
            item,
            resolved: actors,
            ticket: item.ticket_id ? (ticketById.get(item.ticket_id) ?? null) : null,
            comment:
              item.source_kind === 'ticket_comment' ? (commentById.get(item.source_ref) ?? null) : null,
          })
        ),
      }
    }),

  markInboxAttentionRead: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.string().trim().min(1)).optional(),
        ticketId: z.string().trim().min(1).optional(),
        state: attentionStateSchema.default('all'),
        unreadOnly: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const statuses = input.state === 'all' ? undefined : [input.state]
      const ids = [...new Set((input.ids ?? []).filter(Boolean))]
      const updated = await markAttentionItemsRead({
        targetKind: 'user',
        targetRef: userId,
        ids: ids.length > 0 ? ids : undefined,
        ticketId: input.ticketId,
        statuses,
        unreadOnly: input.unreadOnly,
        readByKind: 'user',
        readByRef: userId,
      })

      return { updated }
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

  listGoals: protectedProcedure
    .input(goalListInputSchema.optional())
    .query(async ({ ctx, input }) => {
      const scope = input?.scope ?? 'all'
      const userId = scope !== 'all' ? requireUserId(ctx.session) : undefined
      const db = getDb()

      // Resolve scope into ownerKind/ownerRef filters (only when not explicitly set)
      let ownerKind = input?.ownerKind
      let ownerRef = input?.ownerRef
      const teamId = input?.teamId
      let teamIds: string[] | undefined

      if (scope === 'mine' && !ownerKind && !ownerRef) {
        ownerKind = 'user'
        ownerRef = userId
      } else if (scope === 'my_team' && !teamId) {
        const teamMemberships = await db
          .selectFrom('team_members')
          .select(['team_id'])
          .where('user_id', '=', userId!)
          .execute()
        teamIds = teamMemberships.map((m) => m.team_id)
      }

      const goals = await listGoals({
        statuses: input?.statuses,
        q: input?.q,
        ownerKind,
        ownerRef,
        teamId,
        includeArchived: input?.includeArchived,
        limit: input?.limit,
        sortBy: input?.sort?.field,
        sortDirection: input?.sort?.direction,
      })

      // Post-filter for my_team scope (multiple team IDs)
      let filtered = goals
      if (scope === 'my_team' && teamIds && teamIds.length > 0) {
        const teamIdSet = new Set(teamIds)
        filtered = goals.filter(
          (g) =>
            (g.owner_kind === 'team' && g.owner_ref && teamIdSet.has(g.owner_ref)) ||
            (g.team_id && teamIdSet.has(g.team_id))
        )
      }

      const rows = await enrichGoals(filtered)
      return input?.staleOnly ? rows.filter((goal) => goal.isStale) : rows
    }),

  getGoal: protectedProcedure
    .input(z.object({ goalId: z.string().min(1) }))
    .query(async ({ input }) => {
      const goal = await findGoalById(input.goalId)
      if (!goal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found.' })
      }

      const goalRow = requireFirst(await enrichGoals([goal]), 'goal')
      const [allGoals, tickets, updates] = await Promise.all([
        listGoals({ includeArchived: false }),
        listTickets({ goalId: goal.id, includeArchived: false }),
        listWorkUpdates({ goalId: goal.id, limit: 20 }),
      ])

      const goalsByParent = new Map<string, typeof allGoals>()
      for (const row of allGoals) {
        if (!row.parent_goal_id) continue
        const siblings = goalsByParent.get(row.parent_goal_id) ?? []
        siblings.push(row)
        goalsByParent.set(row.parent_goal_id, siblings)
      }

      const descendantGoals: typeof allGoals = []
      const collectDescendants = (parentGoalId: string) => {
        const children = [...(goalsByParent.get(parentGoalId) ?? [])].sort(
          (a, b) => a.sort_order - b.sort_order
        )
        for (const child of children) {
          descendantGoals.push(child)
          collectDescendants(child.id)
        }
      }

      collectDescendants(goal.id)

      const updateActors = await resolveActors(
        updates.map((update) => ({ kind: update.author_kind, ref: update.author_ref }))
      )
      const ticketRows = await enrichTickets(tickets)
      const ticketReceiptSummaries = await Promise.all(
        ticketRows.map(async (ticket) => ({
          ticketId: ticket.id,
          summary: await buildTicketReceiptSummary(ticket.id),
        }))
      )
      const directGoalReceiptSummary = await buildReceiptSummaryFromWorkItems({
        workItems: await listWorkItemsBySessionPrefix(`app:goal:${goal.id}`),
      })
      const goalRollup = mergeReceiptSummaryRollups([
        ...ticketReceiptSummaries.map((entry) => entry.summary),
        directGoalReceiptSummary,
      ])

      return {
        ...goalRow,
        childGoals: await enrichGoals(descendantGoals),
        tickets: ticketRows.map((ticket) => ({
          ...ticket,
          receiptSummary:
            ticketReceiptSummaries.find((entry) => entry.ticketId === ticket.id)?.summary ?? null,
        })),
        updates: updates.map((update) => presentWorkUpdate(update, updateActors)),
        rollup: goalRollup,
      }
    }),

  createGoal: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(200),
        outcome: z.string().trim().min(1).max(4000),
        parentGoalId: z.string().trim().optional().nullable(),
        ownerKind: actorKindSchema.optional().nullable(),
        ownerRef: z.string().trim().optional().nullable(),
        teamId: z.string().trim().optional().nullable(),
        progressSource: progressSourceSchema.optional(),
        progressTarget: z.number().optional().nullable(),
        progressUnit: z.string().max(50).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const goal = await createGoal({
        parent_goal_id: input.parentGoalId ?? null,
        title: input.title,
        outcome: input.outcome,
        status: 'draft',
        owner_kind: input.ownerKind ?? null,
        owner_ref: input.ownerRef ?? null,
        team_id: input.teamId ?? null,
        created_by_user_id: userId,
        archived_at: null,
        ...(input.progressSource !== undefined && {
          progress_source: input.progressSource,
        }),
        ...(input.progressTarget !== undefined && {
          progress_target: input.progressTarget ?? null,
        }),
        ...(input.progressUnit !== undefined && {
          progress_unit: input.progressUnit ?? null,
        }),
      })

      await createWorkUpdate({
        goal_id: goal.id,
        ticket_id: null,
        team_id: goal.team_id,
        author_kind: 'system',
        author_ref: null,
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
          ownerKind: actorKindSchema.optional().nullable(),
          ownerRef: z.string().trim().optional().nullable(),
          teamId: z.string().trim().optional().nullable(),
          parentGoalId: z.string().trim().optional().nullable(),
          progressSource: progressSourceSchema.optional(),
          progressCurrent: z.number().optional().nullable(),
          progressTarget: z.number().optional().nullable(),
          progressUnit: z.string().max(50).optional().nullable(),
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
        progress_source:
          input.patch.progressSource === undefined
            ? existing.progress_source
            : input.patch.progressSource,
        progress_current:
          input.patch.progressCurrent === undefined
            ? existing.progress_current
            : (input.patch.progressCurrent ?? null),
        progress_target:
          input.patch.progressTarget === undefined
            ? existing.progress_target
            : (input.patch.progressTarget ?? null),
        progress_unit:
          input.patch.progressUnit === undefined
            ? existing.progress_unit
            : (input.patch.progressUnit ?? null),
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
          author_kind: 'system',
          author_ref: null,
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
          author_kind: 'system',
          author_ref: null,
          kind: 'note',
          body: `Owner changed from ${existing.owner_kind ?? 'none'}:${existing.owner_ref ?? 'none'} to ${updated.owner_kind ?? 'none'}:${updated.owner_ref ?? 'none'}.`,
          metadata_json: null,
        })

        await syncGoalHeartbeatToOwner({
          goalId: updated.id,
          userId,
          ownerKind: updated.owner_kind,
          ownerRef: updated.owner_ref,
          teamId: updated.team_id,
        })
      }

      const teamChanged = input.patch.teamId !== undefined && updated.team_id !== existing.team_id

      if (teamChanged) {
        await createWorkUpdate({
          goal_id: updated.id,
          ticket_id: null,
          team_id: updated.team_id,
          author_kind: 'system',
          author_ref: null,
          kind: 'note',
          body: `Team changed from ${existing.team_id ?? 'none'} to ${updated.team_id ?? 'none'}.`,
          metadata_json: null,
        })
      }

      return requireFirst(await enrichGoals([updated]), 'goal')
    }),

  updateGoalProgress: protectedProcedure
    .input(
      z.object({
        goalId: z.string().min(1),
        value: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const existing = await findGoalById(input.goalId)
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found.' })
      }

      const updated = await updateGoal(input.goalId, {
        progress_current: input.value,
      })

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found.' })
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
      // For 'my_team' scope, find agents that belong to the user's teams
      let myTeamAgentIds: Set<string> | undefined
      if (scope === 'my_team') {
        const teamMemberships = await db
          .selectFrom('team_members')
          .select(['team_id'])
          .where('user_id', '=', userId)
          .execute()
        const teamIds = teamMemberships.map((m) => m.team_id)
        if (teamIds.length > 0) {
          const agentTeams = await db
            .selectFrom('agent_teams')
            .select(['agent_id'])
            .where('team_id', 'in', teamIds)
            .execute()
          myTeamAgentIds = new Set(agentTeams.map((at) => at.agent_id))
        } else {
          myTeamAgentIds = new Set()
        }
      }

      let tickets = await listTickets({
        statuses: input?.statuses ?? ['inbox', 'ready', 'in_progress', 'blocked', 'done'],
        q: input?.q,
        goalId: input?.goalId,
        assigneeKind: scope === 'mine' ? 'user' : input?.assigneeKind,
        assigneeRef: scope === 'mine' ? userId : scope === 'all' ? input?.assigneeRef : undefined,
        includeArchived: input?.includeArchived,
        limit: input?.limit ?? 100,
        staleBefore,
        sortBy: input?.sort?.field,
        sortDirection: input?.sort?.direction,
      })

      if (scope === 'my_team' && myTeamAgentIds) {
        tickets = tickets.filter(
          (ticket) =>
            // Tickets assigned to agents on the user's teams
            (ticket.assignee_kind === 'agent' &&
              ticket.assignee_ref &&
              myTeamAgentIds.has(ticket.assignee_ref)) ||
            // Tickets assigned to the user themselves
            (ticket.assignee_kind === 'user' && ticket.assignee_ref === userId)
        )
      } else if (scope === 'unclaimed') {
        tickets = tickets.filter((ticket) => !ticket.assignee_kind)
      }

      return enrichTickets(tickets)
    }),

  getTicket: protectedProcedure
    .input(z.object({ ticketId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const userId = requireUserId(ctx.session)
      const ticket = await findTicketById(input.ticketId)
      if (!ticket) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found.' })
      }

      const ticketRow = requireFirst(await enrichTickets([ticket]), 'ticket')
      const db = getDb()
      const [updates, related, receiptSummary, comments, participants, attentionItems] =
        await Promise.all([
        listWorkUpdates({ ticketId: ticket.id, limit: 30 }),
        listRelatedTickets({
          text: `${ticket.title} ${ticket.body ?? ''}`,
          excludeTicketId: ticket.id,
          limit: 5,
        }),
        buildTicketReceiptSummary(ticket.id),
        listTicketComments({ ticketId: ticket.id, limit: 100 }),
        listTicketParticipants(ticket.id),
        listAttentionItems({ ticketId: ticket.id, statuses: ['open'], limit: 50 }),
      ])
      const updateActors = await resolveActors(
        [
          ...updates.map((update) => ({ kind: update.author_kind, ref: update.author_ref })),
          ...comments.flatMap((comment) => {
            const metadata = parseTicketCommentMetadata(comment.metadata_json)
            return [
              { kind: comment.author_kind, ref: comment.author_ref },
              ...(metadata.mentionAgentIds ?? []).map((id) => ({ kind: 'agent', ref: id })),
              ...(metadata.mentionUserIds ?? []).map((id) => ({ kind: 'user', ref: id })),
            ]
          }),
          ...participants.map((participant) => ({
            kind: participant.participant_kind,
            ref: participant.participant_ref,
          })),
          ...attentionItems.map((item) => ({ kind: item.target_kind, ref: item.target_ref })),
        ]
      )

      // Fetch full descendant tree iteratively (breadth-first)
      type DescendantRow = {
        id: string
        title: string
        status: string
        assignee_kind: string | null
        assignee_ref: string | null
        parent_ticket_id: string | null
      }
      const allDescendants: DescendantRow[] = []
      let parentIds = [ticket.id]
      while (parentIds.length > 0) {
        const batch = await db
          .selectFrom('tickets')
          .select(['id', 'title', 'status', 'assignee_kind', 'assignee_ref', 'parent_ticket_id'])
          .where('parent_ticket_id', 'in', parentIds)
          .where('archived_at', 'is', null)
          .orderBy('created_at', 'asc')
          .execute()
        if (batch.length === 0) break
        allDescendants.push(...batch)
        parentIds = batch.map((r) => r.id)
      }

      // Resolve all descendant assignees
      const descendantActors = await resolveActors(
        allDescendants.map((r) => ({ kind: r.assignee_kind, ref: r.assignee_ref }))
      )

      // Build nested tree structure
      const nodeMap = new Map<string, TicketTreeNode>()
      for (const row of allDescendants) {
        nodeMap.set(row.id, {
          id: row.id,
          title: row.title,
          status: row.status,
          assignee: presentActor(row.assignee_kind, row.assignee_ref, descendantActors),
          children: [],
        })
      }
      const rootChildren: TicketTreeNode[] = []
      for (const row of allDescendants) {
        const node = nodeMap.get(row.id)!
        if (row.parent_ticket_id === ticket.id) {
          rootChildren.push(node)
        } else {
          const parentNode = nodeMap.get(row.parent_ticket_id!)
          if (parentNode) parentNode.children.push(node)
        }
      }

      // Compute direct child progress
      const directChildren = allDescendants.filter((r) => r.parent_ticket_id === ticket.id)
      const childProgress = {
        done: directChildren.filter((r) => r.status === 'done').length,
        total: directChildren.length,
      }

      return {
        ...ticketRow,
        currentUserId: userId,
        updates: updates.map((update) => presentWorkUpdate(update, updateActors)),
        comments: comments.map((comment) => presentTicketComment(comment, updateActors)),
        participants: participants
          .map((participant) => ({
            kind: participant.participant_kind,
            ref: participant.participant_ref,
            addedAt: participant.created_at,
            actor: presentActor(participant.participant_kind, participant.participant_ref, updateActors),
          }))
          .filter((participant) => participant.actor),
        attentionItems: attentionItems.map((item) => presentAttentionItem(item, updateActors)),
        childTickets: rootChildren,
        childProgress,
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
        author_kind: 'system',
        author_ref: null,
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
        author_kind: 'system',
        author_ref: null,
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
          author_kind: 'system',
          author_ref: null,
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
          author_kind: 'system',
          author_ref: null,
          kind: 'note',
          body: `Assigned to ${label}.`,
          metadata_json: null,
        })
      }

      return requireFirst(await enrichTickets([updated]), 'ticket')
    }),

  postTicketComment: protectedProcedure
    .input(
      z.object({
        ticketId: z.string().trim().min(1),
        kind: ticketCommentKindSchema.default('comment'),
        body: z.string().trim().min(1).max(4000),
        mentionAgentIds: z.array(z.string().trim().min(1)).default([]),
        mentionUserIds: z.array(z.string().trim().min(1)).default([]),
        markBlocked: z.boolean().default(false),
        kickstartAgentMentions: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const db = getDb()
      const [ticket, author] = await Promise.all([
        findTicketById(input.ticketId),
        db.selectFrom('users').select(['id', 'name']).where('id', '=', userId).executeTakeFirst(),
      ])

      if (!ticket) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found.' })
      }
      if (!author) {
        throw new TRPCError({ code: 'UNAUTHORIZED' })
      }

      const mentionAgentIds = [...new Set(input.mentionAgentIds.filter(Boolean))]
      const mentionUserIds = [...new Set(input.mentionUserIds.filter((id) => id && id !== userId))]
      const mentionedAgents =
        mentionAgentIds.length > 0
          ? await db
              .selectFrom('agents')
              .select(['id', 'name', 'handle'])
              .where('id', 'in', mentionAgentIds)
              .execute()
          : []
      const mentionedUsers =
        mentionUserIds.length > 0
          ? await db
              .selectFrom('users')
              .select(['id', 'name'])
              .where('id', 'in', mentionUserIds)
              .execute()
          : []

      const metadataJson = JSON.stringify({
        mentionAgentIds: mentionedAgents.map((agent) => agent.id),
        mentionUserIds: mentionedUsers.map((user) => user.id),
      })

      const comment = await createTicketComment({
        ticket_id: ticket.id,
        author_kind: 'user',
        author_ref: userId,
        kind: input.kind,
        body: input.body,
        metadata_json: metadataJson,
      })

      await addTicketParticipants({
        ticketId: ticket.id,
        participants: [
          { kind: 'user', ref: userId },
          ...mentionedAgents.map((agent) => ({ kind: 'agent' as const, ref: agent.id })),
          ...mentionedUsers.map((user) => ({ kind: 'user' as const, ref: user.id })),
        ],
        addedByKind: 'user',
        addedByRef: userId,
      })

      await resolveAttentionItemsForTargetOnTicket({
        ticketId: ticket.id,
        targetKind: 'user',
        targetRef: userId,
        resolvedByKind: 'user',
        resolvedByRef: userId,
      })

      for (const user of mentionedUsers) {
        await createAttentionItem({
          target_kind: 'user',
          target_ref: user.id,
          source_kind: 'ticket_comment',
          source_ref: comment.id,
          ticket_id: ticket.id,
          goal_id: ticket.goal_id,
          status: 'open',
          title: `${author.name} mentioned you on ${ticket.title}`,
          body: input.body,
          metadata_json: metadataJson,
          resolved_at: null,
          resolved_by_kind: null,
          resolved_by_ref: null,
        })
      }

      const queuedAgentWorkItems = []
      for (const agent of mentionedAgents) {
        await createAttentionItem({
          target_kind: 'agent',
          target_ref: agent.id,
          source_kind: 'ticket_comment',
          source_ref: comment.id,
          ticket_id: ticket.id,
          goal_id: ticket.goal_id,
          status: 'open',
          title: `${author.name} mentioned @${agent.handle} on ${ticket.title}`,
          body: input.body,
          metadata_json: metadataJson,
          resolved_at: null,
          resolved_by_kind: null,
          resolved_by_ref: null,
        })

        if (!input.kickstartAgentMentions) continue

        const workItem = await enqueueTicketAgentWork({
          ticketId: ticket.id,
          agentId: agent.id,
          source: 'ticket_comment',
          sourceRef: `ticket:${ticket.id}:comment:${comment.id}:mention:${agent.id}`,
          title: `Ticket comment: ${ticket.title}`,
          body: [
            `${author.name} mentioned you on ticket "${ticket.title}".`,
            '',
            `Comment type: ${input.kind.replace(/_/g, ' ')}`,
            `Comment: ${input.body}`,
            '',
            'Reply on the ticket thread with a concrete answer, question, or status update before you stop.',
          ].join('\n'),
          senderName: author.name,
          senderUserId: author.id,
          actor: {
            kind: 'user',
            userId: author.id,
            displayName: author.name,
            source: 'ticket_comment',
          },
          createReceiptLink: true,
          metadata: {
            ticketCommentId: comment.id,
            ticketCommentKind: input.kind,
          },
        })
        queuedAgentWorkItems.push(workItem.id)
      }

      if (input.markBlocked || input.kind === 'blocked') {
        const nextStatus =
          ticket.status === 'done' || ticket.status === 'canceled' ? ticket.status : 'blocked'
        if (nextStatus !== ticket.status) {
          await updateTicket(ticket.id, {
            goal_id: ticket.goal_id,
            parent_ticket_id: ticket.parent_ticket_id,
            title: ticket.title,
            body: ticket.body,
            status: nextStatus,
            assignee_kind: ticket.assignee_kind,
            assignee_ref: ticket.assignee_ref,
            claimed_by_kind: ticket.claimed_by_kind,
            claimed_by_ref: ticket.claimed_by_ref,
            claimed_at: ticket.claimed_at,
            archived_at: ticket.archived_at,
          })

          await createWorkUpdate({
            goal_id: ticket.goal_id,
            ticket_id: ticket.id,
            team_id: null,
            author_kind: 'system',
            author_ref: null,
            kind: 'status',
            body: `Status changed from ${ticket.status} to blocked.`,
            metadata_json: JSON.stringify({ ticketCommentId: comment.id }),
          })
        }
      }

      return {
        commentId: comment.id,
        queuedAgentWorkItems,
      }
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
            author_kind: 'system',
            author_ref: null,
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

      if (input.kind === 'heartbeat') {
        if (!input.goalId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Heartbeat updates must target a goal.',
          })
        }

        if (input.teamId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Team heartbeat updates have been removed.',
          })
        }
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
        cronExpr: z.string().trim().min(1),
        timezone: z.string().trim().min(1).optional(),
        enabled: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const db = getDb()
      const ownerAgent = await findGoalHeartbeatOwner(input.targetId)
      if (!ownerAgent) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Goal stewardship requires an agent owner.',
        })
      }

      const sessionKey = buildHeartbeatSessionKey(input.targetKind, input.targetId)
      const existing = await db
        .selectFrom('routines')
        .selectAll()
        .where('target_session_key', '=', sessionKey)
        .where('archived_at', 'is', null)
        .orderBy('created_at', 'desc')
        .executeTakeFirst()
      const timezone = input.timezone?.trim() || existing?.timezone || 'UTC'
      const goalHeartbeat = await buildGoalHeartbeatRoutineSpec({
        goalId: input.targetId,
        ownerAgent,
      })
      const targetLabel = goalHeartbeat.targetLabel
      const sessionTitle = goalHeartbeat.sessionTitle
      const actionPrompt = goalHeartbeat.actionPrompt
      const goalId: string | null = goalHeartbeat.goal.id
      const teamId: string | null = null

      await ensureHeartbeatSession({
        sessionKey,
        title: sessionTitle,
        ownerUserId: userId,
        agentId: ownerAgent.agentId,
      })

      const nextRunAt = input.enabled ? validateCronSchedule(input.cronExpr, timezone) : null

      const name = `Goal Stewardship · ${targetLabel}`
      const description = `Recurring stewardship loop for goal ${targetLabel}.`
      const routinePatch = {
        agent_id: ownerAgent.agentId,
        name,
        description,
        enabled: input.enabled ? 1 : 0,
        trigger_kind: 'cron',
        cron_expr: input.cronExpr,
        timezone,
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
        author_kind: 'system',
        author_ref: null,
        kind: 'note',
        body: existing
          ? 'Updated goal stewardship schedule.'
          : 'Configured goal stewardship schedule.',
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
        author_kind: 'system',
        author_ref: null,
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
        author_kind: 'system',
        author_ref: null,
        kind: 'note',
        body: `Promoted untracked session ${input.sessionKey} into a ticket.`,
        metadata_json: null,
      })

      return {
        ticket: requireFirst(await enrichTickets([ticket]), 'ticket'),
        created: true,
      }
    }),

  reorderGoal: protectedProcedure
    .input(
      z.object({
        goalId: z.string().trim().min(1),
        newParentGoalId: z.string().trim().nullable(),
        sortOrder: z.number().int().min(0),
      })
    )
    .mutation(async ({ input }) => {
      // Cycle detection: walk ancestors of newParentGoalId to ensure goalId is not among them
      if (input.newParentGoalId) {
        const visited = new Set<string>()
        let currentId: string | null = input.newParentGoalId
        while (currentId) {
          if (currentId === input.goalId) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Cannot move a goal under itself or one of its descendants.',
            })
          }
          if (visited.has(currentId)) break
          visited.add(currentId)
          const parent = await findGoalById(currentId)
          currentId = parent?.parent_goal_id ?? null
        }
      }

      const updated = await reorderGoal(input.goalId, input.newParentGoalId, input.sortOrder)
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found.' })
      }

      return requireFirst(await enrichGoals([updated]), 'goal')
    }),

  reorderTicket: protectedProcedure
    .input(
      z.object({
        ticketId: z.string().trim().min(1),
        newParentTicketId: z.string().trim().nullable(),
        sortOrder: z.number().int().min(0),
      })
    )
    .mutation(async ({ input }) => {
      // Cycle detection: walk ancestors of newParentTicketId to ensure ticketId is not among them
      if (input.newParentTicketId) {
        const visited = new Set<string>()
        let currentId: string | null = input.newParentTicketId
        while (currentId) {
          if (currentId === input.ticketId) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Cannot move a ticket under itself or one of its descendants.',
            })
          }
          if (visited.has(currentId)) break
          visited.add(currentId)
          const parent = await findTicketById(currentId)
          currentId = parent?.parent_ticket_id ?? null
        }
      }

      const updated = await reorderTicket(input.ticketId, input.newParentTicketId, input.sortOrder)
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found.' })
      }

      return requireFirst(await enrichTickets([updated]), 'ticket')
    }),
})
