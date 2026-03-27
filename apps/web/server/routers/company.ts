import { TRPCError } from '@trpc/server'
import { parseAgentConfig } from '@nitejar/agent/config'
import {
  addAgentToTeam,
  assignDefaultRoleToTeam,
  assignRoleToAgent,
  createRole,
  createTeam,
  createWorkUpdate,
  createWorkView,
  deleteRole as deleteRoleRecord,
  deleteGoalAgentAllocation,
  deleteWorkView,
  findAgentById,
  findGoalById,
  findRoleById,
  findTeamById,
  findWorkViewById,
  getCompanyOverviewRollup,
  getDb,
  getTeamSpendInWindow,
  listAgentRoleAssignments,
  listRoleGitHubRepoPolicies,
  listRoleDefaults,
  listRoleGrants,
  listRoles,
  listTeamRoleDefaults,
  GITHUB_REPO_CAPABILITY_IDS,
  sql,
  listAgentAllocationRollups,
  listGoalCoverageRollups,
  listTeamPortfolioRollups,
  listWorkViews,
  removeDefaultRoleFromTeam,
  removeRoleFromAgent,
  replaceRoleGitHubRepoPolicies,
  replaceRoleDefaults,
  replaceRoleGrants,
  resolveEffectivePolicy,
  updateRole,
  writePolicyAuditLog,
  removeAgentFromTeam,
  updateGoal,
  updateTeam,
  updateWorkView,
  upsertGoalAgentAllocation,
} from '@nitejar/database'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

type ResolvedActor = {
  kind: 'user' | 'agent' | 'team'
  ref: string
  label: string
  handle?: string | null
  title?: string | null
  avatarUrl?: string | null
  emoji?: string | null
} | null

const companyFilterSchema = z.object({
  q: z.string().trim().optional(),
  ownerRef: z.string().trim().optional(),
  ownershipStatus: z.enum(['any', 'owned', 'unowned']).optional(),
  teamId: z.string().trim().optional(),
  health: z.array(z.enum(['draft', 'active', 'at_risk', 'blocked', 'done', 'archived'])).optional(),
  coverageStatus: z.array(z.enum(['covered', 'thin', 'unstaffed', 'overloaded'])).optional(),
  staleOnly: z.boolean().optional(),
  staleAgeHours: z
    .number()
    .int()
    .min(0)
    .max(24 * 30)
    .optional(),
  staffingDepthMax: z.number().int().min(0).max(50).optional(),
  blockedLoadMin: z.number().int().min(0).max(100).optional(),
  recentActivityHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .optional(),
})

const companySortFieldSchema = z.enum([
  'priority',
  'title',
  'health',
  'coverage',
  'progress',
  'staffing_depth',
  'blocked_load',
  'last_activity_at',
  'last_heartbeat_at',
])

const companyGroupBySchema = z.enum(['team', 'owner', 'health', 'coverage'])

const companyViewSchema = z.object({
  entityKind: z.literal('company'),
  name: z.string().trim().min(1).max(80),
  filters: companyFilterSchema,
  sort: z
    .object({
      field: companySortFieldSchema,
      direction: z.enum(['asc', 'desc']).default('desc'),
    })
    .optional()
    .nullable(),
  groupBy: companyGroupBySchema.optional().nullable(),
})

const policyGrantInputSchema = z.object({
  action: z.string().trim().min(1),
  resourceType: z.string().trim().optional().nullable(),
  resourceId: z.string().trim().optional().nullable(),
})

const policyDefaultInputSchema = z.object({
  key: z.string().trim().min(1),
  value: z.unknown(),
})

const gitHubRepoCapabilitySchema = z.enum(GITHUB_REPO_CAPABILITY_IDS)

const roleGitHubRepoPolicyInputSchema = z.object({
  githubRepoId: z.number().int(),
  capabilities: z.array(gitHubRepoCapabilitySchema),
})

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

function parseStoredJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function parsePolicyJsonValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
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

function healthRank(health: string) {
  if (health === 'blocked') return 0
  if (health === 'at_risk') return 1
  if (health === 'active') return 2
  if (health === 'draft') return 3
  return 4
}

function coverageRank(coverage: string) {
  if (coverage === 'unstaffed') return 0
  if (coverage === 'overloaded') return 1
  if (coverage === 'thin') return 2
  return 3
}

function classifyManagementEvent(args: { kind: string; body: string; teamId: string | null }) {
  const body = args.body.toLowerCase()
  if (args.kind === 'heartbeat') {
    return 'goal_heartbeat'
  }
  if (body.includes('owner changed')) return 'ownership_changed'
  if (body.includes('team changed')) return 'team_changed'
  if (body.includes('staffed') || body.includes('unstaffed')) return 'staffing_changed'
  if (body.includes('status changed')) return 'goal_status_changed'
  if (body.includes('assigned to')) return 'queue_shift'
  return args.kind === 'status' ? 'status' : 'note'
}

async function buildCompanyOverview() {
  const db = getDb()
  const [summary, goalCoverage, teamRollups, agentRollups, recentUpdates, allTeams] =
    await Promise.all([
      getCompanyOverviewRollup(),
      listGoalCoverageRollups(),
      listTeamPortfolioRollups(),
      listAgentAllocationRollups(),
      db
        .selectFrom('work_updates')
        .select([
          'id',
          'goal_id',
          'team_id',
          'author_kind',
          'author_ref',
          'kind',
          'body',
          'created_at',
        ])
        .where((eb) => eb.or([eb('goal_id', 'is not', null), eb('team_id', 'is not', null)]))
        .orderBy('created_at', 'desc')
        .limit(40)
        .execute(),
      db
        .selectFrom('teams')
        .select(['id', 'name', 'charter', 'parent_team_id', 'sort_order', 'lead_kind', 'lead_ref'])
        .orderBy('sort_order', 'asc')
        .orderBy('name', 'asc')
        .execute(),
    ])

  const goalIds = goalCoverage.map((goal) => goal.goal_id)
  const teamIds = [
    ...new Set([
      ...goalCoverage.flatMap((goal) => goal.active_team_ids),
      ...goalCoverage
        .map((goal) => goal.primary_team_id)
        .filter((teamId): teamId is string => typeof teamId === 'string'),
      ...agentRollups.flatMap((agent) => agent.team_ids),
      ...recentUpdates
        .map((update) => update.team_id)
        .filter((teamId): teamId is string => typeof teamId === 'string'),
    ]),
  ]
  const agentIds = [
    ...new Set([
      ...goalCoverage.flatMap((goal) => goal.staffed_agent_ids),
      ...goalCoverage.flatMap((goal) => goal.allocated_agent_ids),
      ...agentRollups.map((agent) => agent.agent_id),
    ]),
  ]

  const [goals, teamMembers, teamAgents, actors] = await Promise.all([
    goalIds.length > 0
      ? db
          .selectFrom('goals')
          .select(['id', 'parent_goal_id', 'title', 'outcome'])
          .where('id', 'in', goalIds)
          .execute()
      : Promise.resolve([]),
    teamIds.length > 0
      ? db
          .selectFrom('team_members')
          .innerJoin('users', 'users.id', 'team_members.user_id')
          .select([
            'team_members.team_id as team_id',
            'users.id as user_id',
            'users.name as name',
            'users.avatar_url as avatar_url',
            'team_members.role as role',
          ])
          .where('team_members.team_id', 'in', teamIds)
          .execute()
      : Promise.resolve([]),
    teamIds.length > 0
      ? db
          .selectFrom('agent_teams')
          .innerJoin('agents', 'agents.id', 'agent_teams.agent_id')
          .leftJoin('agent_role_assignments', 'agent_role_assignments.agent_id', 'agents.id')
          .leftJoin('roles', 'roles.id', 'agent_role_assignments.role_id')
          .select([
            'agent_teams.team_id as team_id',
            'agents.id as agent_id',
            'agents.name as name',
            'agents.handle as handle',
            'agents.config as config',
            'roles.name as role_name',
          ])
          .where('agent_teams.team_id', 'in', teamIds)
          .execute()
      : Promise.resolve([]),
    resolveActors([
      ...goalCoverage.map((goal) => ({ kind: goal.owner_kind, ref: goal.owner_ref })),
      ...goalCoverage.map((goal) => ({ kind: 'team', ref: goal.primary_team_id })),
      ...goalCoverage.flatMap((goal) =>
        goal.staffed_agent_ids.map((agentId) => ({ kind: 'agent', ref: agentId }))
      ),
      ...goalCoverage.flatMap((goal) =>
        goal.active_team_ids.map((teamId) => ({ kind: 'team', ref: teamId }))
      ),
      ...agentIds.map((agentId) => ({ kind: 'agent', ref: agentId })),
      ...teamIds.map((teamId) => ({ kind: 'team', ref: teamId })),
      ...recentUpdates.map((update) => ({ kind: update.author_kind, ref: update.author_ref })),
      ...recentUpdates.map((update) => ({ kind: 'team', ref: update.team_id })),
    ]),
  ])

  const goalMap = new Map(goals.map((goal) => [goal.id, goal]))
  const allTeamsMap = new Map(allTeams.map((team) => [team.id, team]))

  const goalsInProgress = goalCoverage
    .filter((goal) => goal.goal_status !== 'done' && goal.goal_status !== 'archived')
    .map((goal) => {
      const totalTicketCount = goal.open_ticket_count + goal.done_ticket_count
      const progressPct =
        totalTicketCount > 0 ? Math.round((goal.done_ticket_count / totalTicketCount) * 100) : 0
      const blockedLoadPct =
        goal.open_ticket_count > 0
          ? Math.round((goal.blocked_ticket_count / goal.open_ticket_count) * 100)
          : 0

      return {
        id: goal.goal_id,
        parentGoalId: goalMap.get(goal.goal_id)?.parent_goal_id ?? null,
        title: goalMap.get(goal.goal_id)?.title ?? 'Untitled goal',
        outcome: goalMap.get(goal.goal_id)?.outcome ?? '',
        status: goal.goal_status,
        health: goal.health,
        coverageStatus: goal.coverage_status,
        owner: presentActor(goal.owner_kind, goal.owner_ref, actors),
        team: presentActor('team', goal.team_id ?? goal.primary_team_id, actors),
        staffedAgents: goal.staffed_agent_ids
          .map((agentId) => presentActor('agent', agentId, actors))
          .filter((agent): agent is NonNullable<typeof agent> => !!agent),
        allocatedAgents: goal.allocated_agent_ids
          .map((agentId) => presentActor('agent', agentId, actors))
          .filter((agent): agent is NonNullable<typeof agent> => !!agent),
        staffedTeams: goal.active_team_ids
          .map((teamId) => presentActor('team', teamId, actors))
          .filter((team): team is NonNullable<typeof team> => !!team),
        staffingDepth: goal.staffing_depth,
        openTicketCount: goal.open_ticket_count,
        blockedTicketCount: goal.blocked_ticket_count,
        inProgressTicketCount: goal.in_progress_ticket_count,
        readyTicketCount: goal.ready_ticket_count,
        inboxTicketCount: goal.inbox_ticket_count,
        doneTicketCount: goal.done_ticket_count,
        blockedLoadPct,
        progressPct,
        lastHeartbeatAt: goal.last_heartbeat_at,
        lastActivityAt: goal.last_activity_at,
        isStale: goal.is_stale,
        receiptLinks: {
          goal: `/goals/${goal.goal_id}`,
          work: `/tickets`,
          agents: `/agents`,
          activity: `/activity`,
          costs: `/costs`,
          sessions: `/sessions`,
        },
      }
    })
    .sort((a, b) => {
      const healthDiff = healthRank(a.health) - healthRank(b.health)
      if (healthDiff !== 0) return healthDiff
      const coverageDiff = coverageRank(a.coverageStatus) - coverageRank(b.coverageStatus)
      if (coverageDiff !== 0) return coverageDiff
      if (b.blockedLoadPct !== a.blockedLoadPct) return b.blockedLoadPct - a.blockedLoadPct
      return b.lastActivityAt - a.lastActivityAt
    })

  const teamMembersByTeam = new Map<
    string,
    Array<{ id: string; name: string; avatarUrl: string | null; role: string }>
  >()
  for (const member of teamMembers) {
    const current = teamMembersByTeam.get(member.team_id) ?? []
    current.push({
      id: member.user_id,
      name: member.name,
      avatarUrl: member.avatar_url,
      role: member.role,
    })
    teamMembersByTeam.set(member.team_id, current)
  }

  const teamAgentsByTeam = new Map<
    string,
    Array<{
      id: string
      name: string
      handle: string
      title: string | null
      avatarUrl: string | null
      emoji: string | null
    }>
  >()
  for (const agent of teamAgents) {
    const current = teamAgentsByTeam.get(agent.team_id) ?? []
    const parsed = parseAgentConfig(agent.config)
    current.push({
      id: agent.agent_id,
      name: agent.name,
      handle: agent.handle,
      title: agent.role_name ?? null,
      avatarUrl: parsed.avatarUrl ?? null,
      emoji: parsed.emoji ?? null,
    })
    teamAgentsByTeam.set(agent.team_id, current)
  }

  const teams = teamRollups.map((team) => ({
    id: team.team_id,
    parentTeamId: allTeamsMap.get(team.team_id)?.parent_team_id ?? null,
    name: team.name,
    charter: team.charter,
    memberCount: team.member_count,
    agentCount: team.agent_count,
    ownedGoalCount: team.owned_goal_count,
    staffedGoalCount: team.staffed_goal_count,
    activeGoalCount: team.active_goal_count,
    atRiskGoalCount: team.at_risk_goal_count,
    blockedGoalCount: team.blocked_goal_count,
    queuedTicketCount: team.queued_ticket_count,
    blockedTicketCount: team.blocked_ticket_count,
    goalsNeedingStaffingCount: team.goals_needing_staffing_count,
    overloadedAgentCount: team.overloaded_agent_count,
    members: teamMembersByTeam.get(team.team_id) ?? [],
    agents: teamAgentsByTeam.get(team.team_id) ?? [],
    goals: goalsInProgress
      .filter(
        (goal) =>
          goal.team?.ref === team.team_id ||
          goal.staffedTeams.some((entry) => entry.ref === team.team_id)
      )
      .slice(0, 6)
      .map((goal) => ({
        id: goal.id,
        title: goal.title,
        health: goal.health,
        coverageStatus: goal.coverageStatus,
      })),
    receiptLinks: {
      work: `/work`,
      agents: `/agents`,
      activity: `/activity`,
      costs: `/costs`,
    },
  }))

  const agents = agentRollups.map((agent) => ({
    id: agent.agent_id,
    actor: presentActor('agent', agent.agent_id, actors),
    primaryTeam: presentActor('team', agent.primary_team_id, actors),
    teams: agent.team_ids
      .map((teamId) => presentActor('team', teamId, actors))
      .filter((team): team is NonNullable<typeof team> => !!team),
    goals: agent.goal_ids
      .map((goalId) => {
        const goal = goalsInProgress.find((entry) => entry.id === goalId)
        return goal
          ? {
              id: goal.id,
              title: goal.title,
              health: goal.health,
              coverageStatus: goal.coverageStatus,
            }
          : null
      })
      .filter((goal): goal is NonNullable<typeof goal> => !!goal),
    openTicketCount: agent.open_ticket_count,
    blockedTicketCount: agent.blocked_ticket_count,
    inProgressTicketCount: agent.in_progress_ticket_count,
    readyTicketCount: agent.ready_ticket_count,
    openGoalCount: agent.open_goal_count,
    ownedGoalCount: agent.owned_goal_count,
    activeSessionCount: agent.active_session_count,
    lastActivityAt: agent.last_ticket_activity_at,
    workloadSignal: agent.workload_signal,
    portfolioImpactScore: agent.portfolio_impact_score,
    receiptLinks: {
      agent: `/agents/${agent.agent_id}`,
      work: `/work`,
      sessions: `/sessions`,
      costs: `/costs`,
    },
  }))

  const coverageGaps = goalsInProgress
    .filter(
      (goal) =>
        goal.coverageStatus !== 'covered' || goal.health === 'at_risk' || goal.health === 'blocked'
    )
    .slice(0, 10)

  const recentChanges = recentUpdates.map((update) => ({
    id: update.id,
    kind: classifyManagementEvent({
      kind: update.kind,
      body: update.body,
      teamId: update.team_id,
    }),
    body: update.body,
    createdAt: update.created_at,
    author: presentActor(update.author_kind, update.author_ref, actors),
    goal:
      update.goal_id && goalMap.has(update.goal_id)
        ? {
            id: update.goal_id,
            title: goalMap.get(update.goal_id)?.title ?? 'Goal',
          }
        : null,
    team:
      update.team_id && actors.teams.has(update.team_id)
        ? {
            id: update.team_id,
            name: actors.teams.get(update.team_id)?.name ?? 'Team',
          }
        : null,
  }))

  const ownershipOpenCount = goalsInProgress.filter((goal) => !goal.owner).length
  const idleAgentCount = agents.filter(
    (agent) => agent.openTicketCount === 0 && agent.goals.length === 0
  ).length
  const overloadedTeamCount = teams.filter(
    (team) => team.goalsNeedingStaffingCount > 0 || team.overloadedAgentCount > 0
  ).length

  // Resolve leads for ALL teams using lead_kind/lead_ref on teams table
  const allTeamIds = allTeams.map((t) => t.id)
  const leadActorRefs = allTeams
    .filter((t) => t.lead_kind && t.lead_ref)
    .map((t) => ({ kind: t.lead_kind, ref: t.lead_ref }))
  const leadActors = await resolveActors(leadActorRefs)

  // Count agents per team
  const allAgentCounts =
    allTeamIds.length > 0
      ? await db
          .selectFrom('agent_teams')
          .select(['team_id', sql<number>`count(*)`.as('count')])
          .where('team_id', 'in', allTeamIds)
          .groupBy('team_id')
          .execute()
      : []
  const agentCountByTeamId = new Map(allAgentCounts.map((r) => [r.team_id, r.count]))

  const organization = allTeams.map((team) => {
    const lead =
      team.lead_kind && team.lead_ref
        ? presentActor(team.lead_kind, team.lead_ref, leadActors)
        : null
    return {
      id: team.id,
      parentTeamId: team.parent_team_id,
      name: team.name,
      charter: team.charter,
      sortOrder: team.sort_order,
      agentCount: agentCountByTeamId.get(team.id) ?? 0,
      lead,
    }
  })

  return {
    summary: {
      ...summary,
      ownership_open_count: ownershipOpenCount,
      idle_agent_count: idleAgentCount,
      overloaded_team_count: overloadedTeamCount,
      team_count: allTeams.length,
      staffed_agent_count: new Set(
        goalsInProgress.flatMap((goal) => goal.staffedAgents.map((agent) => agent.ref))
      ).size,
    },
    board: {
      headline: `${summary.active_goal_count} active goals across ${summary.active_team_count} active teams.`,
      subhead: `${summary.blocked_goal_count} blocked, ${summary.unstaffed_goal_count + summary.thin_goal_count} with thin or missing coverage, ${ownershipOpenCount} without a clear owner.`,
      interventions: [
        {
          id: 'blocked-portfolio',
          label: `${summary.blocked_goal_count} blocked goals need intervention`,
          href: '/company',
          tone: summary.blocked_goal_count > 0 ? 'critical' : 'neutral',
        },
        {
          id: 'thin-staffing',
          label: `${summary.unstaffed_goal_count + summary.thin_goal_count} goals are thin or unstaffed`,
          href: '/company',
          tone: summary.unstaffed_goal_count + summary.thin_goal_count > 0 ? 'warning' : 'neutral',
        },
        {
          id: 'idle-capacity',
          label: `${idleAgentCount} agents look idle against the current portfolio`,
          href: '/agents',
          tone: idleAgentCount > 0 ? 'info' : 'neutral',
        },
      ],
    },
    goalsInProgress,
    coverageGaps,
    organization,
    teams,
    agents,
    recentChanges,
  }
}

export const companyRouter = router({
  getOverview: protectedProcedure.query(async () => buildCompanyOverview()),

  listViews: protectedProcedure.query(async ({ ctx }) => {
    const userId = requireUserId(ctx.session)
    const views = await listWorkViews({
      ownerUserId: userId,
      entityKind: 'company',
      scope: 'user',
      limit: 100,
    })
    return views.map(presentWorkView)
  }),

  upsertView: protectedProcedure
    .input(
      z.object({
        viewId: z.string().trim().optional(),
        view: companyViewSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const filtersJson = JSON.stringify(input.view.filters)
      const sortJson = JSON.stringify(input.view.sort ?? null)

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
        entity_kind: 'company',
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

  assignGoalTeam: protectedProcedure
    .input(
      z.object({
        goalId: z.string().trim().min(1),
        teamId: z.string().trim().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const goal = await findGoalById(input.goalId)
      if (!goal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found.' })
      }

      const updated = await updateGoal(goal.id, {
        parent_goal_id: goal.parent_goal_id,
        title: goal.title,
        outcome: goal.outcome,
        status: goal.status,
        owner_kind: goal.owner_kind,
        owner_ref: goal.owner_ref,
        team_id: input.teamId ?? null,
        created_by_user_id: goal.created_by_user_id,
        updated_at: goal.updated_at,
        archived_at: goal.archived_at,
      })
      if (!updated) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update goal.' })
      }

      await createWorkUpdate({
        goal_id: goal.id,
        ticket_id: null,
        team_id: input.teamId ?? null,
        author_kind: 'system',
        author_ref: null,
        kind: 'note',
        body: `Team changed from ${goal.team_id ?? 'none'} to ${input.teamId ?? 'none'}.`,
        metadata_json: null,
      })

      return { ok: true }
    }),

  assignGoalOwner: protectedProcedure
    .input(
      z.object({
        goalId: z.string().trim().min(1),
        ownerKind: z.enum(['user', 'agent']).optional().nullable(),
        ownerRef: z.string().trim().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const goal = await findGoalById(input.goalId)
      if (!goal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found.' })
      }

      const updated = await updateGoal(goal.id, {
        parent_goal_id: goal.parent_goal_id,
        title: goal.title,
        outcome: goal.outcome,
        status: goal.status,
        owner_kind: input.ownerKind ?? null,
        owner_ref: input.ownerRef ?? null,
        team_id: goal.team_id,
        created_by_user_id: goal.created_by_user_id,
        updated_at: goal.updated_at,
        archived_at: goal.archived_at,
      })
      if (!updated) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update goal.' })
      }

      await createWorkUpdate({
        goal_id: goal.id,
        ticket_id: null,
        team_id: updated.team_id,
        author_kind: 'system',
        author_ref: null,
        kind: 'note',
        body: `Owner changed from ${goal.owner_kind ?? 'none'}:${goal.owner_ref ?? 'none'} to ${input.ownerKind ?? 'none'}:${input.ownerRef ?? 'none'}.`,
        metadata_json: null,
      })

      return { ok: true }
    }),

  addGoalAgent: protectedProcedure
    .input(
      z.object({
        goalId: z.string().trim().min(1),
        agentId: z.string().trim().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const goal = await findGoalById(input.goalId)
      if (!goal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found.' })
      }

      await upsertGoalAgentAllocation({
        goal_id: input.goalId,
        agent_id: input.agentId,
        created_by_kind: 'user',
        created_by_ref: userId,
      })

      await createWorkUpdate({
        goal_id: goal.id,
        ticket_id: null,
        team_id: goal.team_id,
        author_kind: 'system',
        author_ref: null,
        kind: 'note',
        body: `Staffed goal with agent ${input.agentId}.`,
        metadata_json: null,
      })

      return { ok: true }
    }),

  removeGoalAgent: protectedProcedure
    .input(
      z.object({
        goalId: z.string().trim().min(1),
        agentId: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const goal = await findGoalById(input.goalId)
      if (!goal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found.' })
      }

      await deleteGoalAgentAllocation(input.goalId, input.agentId)
      await createWorkUpdate({
        goal_id: goal.id,
        ticket_id: null,
        team_id: goal.team_id,
        author_kind: 'system',
        author_ref: null,
        kind: 'note',
        body: `Unstaffed agent ${input.agentId} from goal coverage.`,
        metadata_json: null,
      })

      return { ok: true }
    }),

  getTeamDetail: protectedProcedure
    .input(z.object({ teamId: z.string().trim().min(1) }))
    .query(async ({ input }) => {
      const db = getDb()
      const { teamId } = input

      // --- 1. Team row ---
      const teamRow = await db
        .selectFrom('teams')
        .selectAll()
        .where('id', '=', teamId)
        .executeTakeFirst()
      if (!teamRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found.' })
      }

      // Resolve parent team name if present
      let parentTeamName: string | null = null
      if (teamRow.parent_team_id) {
        const parentTeam = await db
          .selectFrom('teams')
          .select(['name'])
          .where('id', '=', teamRow.parent_team_id)
          .executeTakeFirst()
        parentTeamName = parentTeam?.name ?? null
      }

      const childTeamRows = await db
        .selectFrom('teams')
        .selectAll()
        .where('parent_team_id', '=', teamId)
        .orderBy('sort_order', 'asc')
        .orderBy('name', 'asc')
        .execute()
      const childTeamIds = childTeamRows.map((row) => row.id)

      const actorRefs = [
        ...(teamRow.lead_kind && teamRow.lead_ref
          ? [{ kind: teamRow.lead_kind, ref: teamRow.lead_ref }]
          : []),
        ...childTeamRows
          .filter((row) => row.lead_kind && row.lead_ref)
          .map((row) => ({ kind: row.lead_kind, ref: row.lead_ref })),
      ]
      const resolvedActors = await resolveActors(actorRefs)

      // --- 2. Members ---
      const memberRows = await db
        .selectFrom('team_members')
        .innerJoin('users', 'users.id', 'team_members.user_id')
        .select([
          'users.id as id',
          'users.name as name',
          'users.avatar_url as avatar_url',
          'team_members.role as role',
        ])
        .where('team_members.team_id', '=', teamId)
        .execute()

      const members = memberRows.map((row) => ({
        id: row.id,
        name: row.name,
        avatarUrl: row.avatar_url,
        role: row.role,
      }))

      const teamLead =
        teamRow.lead_kind && teamRow.lead_ref
          ? presentActor(teamRow.lead_kind, teamRow.lead_ref, resolvedActors)
          : null

      // --- 3. Agents with workload stats ---
      const agentRows = await db
        .selectFrom('agent_teams')
        .innerJoin('agents', 'agents.id', 'agent_teams.agent_id')
        .leftJoin('agent_role_assignments', 'agent_role_assignments.agent_id', 'agents.id')
        .leftJoin('roles', 'roles.id', 'agent_role_assignments.role_id')
        .select([
          'agents.id as id',
          'agents.name as name',
          'agents.handle as handle',
          'agents.config as config',
          'roles.name as role_name',
        ])
        .where('agent_teams.team_id', '=', teamId)
        .execute()

      const agentIds = agentRows.map((row) => row.id)

      // Get per-agent ticket counts
      const agentTicketCounts =
        agentIds.length > 0
          ? await db
              .selectFrom('tickets')
              .select([
                'assignee_ref as agent_id',
                sql<number>`sum(case when status in ('inbox', 'ready', 'in_progress', 'blocked') then 1 else 0 end)`.as(
                  'open_count'
                ),
                sql<number>`sum(case when status = 'blocked' then 1 else 0 end)`.as(
                  'blocked_count'
                ),
              ])
              .where('archived_at', 'is', null)
              .where('assignee_kind', '=', 'agent')
              .where('assignee_ref', 'in', agentIds)
              .groupBy('assignee_ref')
              .execute()
          : []

      const ticketCountByAgent = new Map(
        agentTicketCounts
          .filter((row): row is typeof row & { agent_id: string } => !!row.agent_id)
          .map((row) => [row.agent_id, { open: row.open_count, blocked: row.blocked_count }])
      )

      const agents = agentRows.map((row) => {
        const parsed = parseAgentConfig(row.config)
        const counts = ticketCountByAgent.get(row.id) ?? { open: 0, blocked: 0 }
        return {
          id: row.id,
          name: row.name,
          handle: row.handle,
          emoji: parsed.emoji ?? null,
          avatarUrl: parsed.avatarUrl ?? null,
          title: row.role_name ?? null,
          openTicketCount: counts.open,
          blockedTicketCount: counts.blocked,
        }
      })

      const [childMemberCounts, childAgentCounts, childRollups] = await Promise.all([
        childTeamIds.length > 0
          ? db
              .selectFrom('team_members')
              .select(['team_id', sql<number>`count(*)`.as('count')])
              .where('team_id', 'in', childTeamIds)
              .groupBy('team_id')
              .execute()
          : Promise.resolve([]),
        childTeamIds.length > 0
          ? db
              .selectFrom('agent_teams')
              .select(['team_id', sql<number>`count(*)`.as('count')])
              .where('team_id', 'in', childTeamIds)
              .groupBy('team_id')
              .execute()
          : Promise.resolve([]),
        childTeamIds.length > 0
          ? listTeamPortfolioRollups({ teamIds: childTeamIds })
          : Promise.resolve([]),
      ])
      const childMemberCountByTeamId = new Map(
        childMemberCounts.map((row) => [row.team_id, row.count])
      )
      const childAgentCountByTeamId = new Map(
        childAgentCounts.map((row) => [row.team_id, row.count])
      )
      const childRollupByTeamId = new Map(childRollups.map((row) => [row.team_id, row]))

      const childTeams = childTeamRows.map((row) => {
        const rollup = childRollupByTeamId.get(row.id)
        const health =
          !rollup || rollup.active_goal_count === 0
            ? 'gray'
            : rollup.blocked_goal_count > 0
              ? 'red'
              : rollup.at_risk_goal_count > 0
                ? 'amber'
                : 'green'
        return {
          id: row.id,
          name: row.name,
          charter: row.charter ?? null,
          lead:
            row.lead_kind && row.lead_ref
              ? presentActor(row.lead_kind, row.lead_ref, resolvedActors)
              : null,
          memberCount: childMemberCountByTeamId.get(row.id) ?? 0,
          agentCount: childAgentCountByTeamId.get(row.id) ?? 0,
          activeGoalCount: rollup?.active_goal_count ?? 0,
          atRiskGoalCount: rollup?.at_risk_goal_count ?? 0,
          blockedGoalCount: rollup?.blocked_goal_count ?? 0,
          queuedTicketCount: rollup?.queued_ticket_count ?? 0,
          blockedTicketCount: rollup?.blocked_ticket_count ?? 0,
          goalsNeedingStaffingCount: rollup?.goals_needing_staffing_count ?? 0,
          health,
        }
      })

      // --- 4. Portfolio rollup ---
      const teamRollups = await listTeamPortfolioRollups({ teamIds: [teamId] })
      const rollup = teamRollups[0]
      const portfolio = rollup
        ? {
            ownedGoalCount: rollup.owned_goal_count,
            activeGoalCount: rollup.active_goal_count,
            atRiskGoalCount: rollup.at_risk_goal_count,
            blockedGoalCount: rollup.blocked_goal_count,
            goalsNeedingStaffingCount: rollup.goals_needing_staffing_count,
            queuedTicketCount: rollup.queued_ticket_count,
            blockedTicketCount: rollup.blocked_ticket_count,
          }
        : {
            ownedGoalCount: 0,
            activeGoalCount: 0,
            atRiskGoalCount: 0,
            blockedGoalCount: 0,
            goalsNeedingStaffingCount: 0,
            queuedTicketCount: 0,
            blockedTicketCount: 0,
          }

      // --- 5. Goals ---
      const goalRows = await db
        .selectFrom('goals')
        .selectAll()
        .where((eb) =>
          eb.or([
            eb('team_id', '=', teamId),
            ...(rollup?.goal_ids?.length ? [eb('id', 'in', rollup.goal_ids)] : []),
          ])
        )
        .where('archived_at', 'is', null)
        .orderBy('updated_at', 'desc')
        .execute()

      const goalIds = goalRows.map((g) => g.id)

      // Get ticket counts per goal
      const goalTicketCounts =
        goalIds.length > 0
          ? await db
              .selectFrom('tickets')
              .select([
                'goal_id',
                sql<number>`count(*)`.as('total'),
                sql<number>`sum(case when status = 'blocked' then 1 else 0 end)`.as('blocked'),
                sql<number>`sum(case when status = 'done' then 1 else 0 end)`.as('done'),
              ])
              .where('goal_id', 'in', goalIds)
              .where('archived_at', 'is', null)
              .groupBy('goal_id')
              .execute()
          : []

      const ticketCountByGoal = new Map(
        goalTicketCounts
          .filter((row): row is typeof row & { goal_id: string } => !!row.goal_id)
          .map((row) => [row.goal_id, { total: row.total, blocked: row.blocked, done: row.done }])
      )

      // Get goal coverage rollups for health info
      const goalCoverage = await listGoalCoverageRollups()
      const coverageByGoalId = new Map(goalCoverage.map((gc) => [gc.goal_id, gc]))

      // Resolve actors for goal owners
      const goalActorRefs = goalRows.flatMap((g) => [{ kind: g.owner_kind, ref: g.owner_ref }])
      const goalActorsResolved = await resolveActors(goalActorRefs)

      const goals = goalRows.map((g) => {
        const coverage = coverageByGoalId.get(g.id)
        const counts = ticketCountByGoal.get(g.id) ?? { total: 0, blocked: 0, done: 0 }
        return {
          id: g.id,
          title: g.title,
          status: g.status,
          health: coverage?.health ?? g.status,
          owner: presentActor(g.owner_kind, g.owner_ref, goalActorsResolved),
          ticketCounts: {
            total: counts.total,
            blocked: counts.blocked,
            done: counts.done,
          },
        }
      })

      // --- 6. Tickets assigned to agents on this team ---
      const teamAgentRows = await db
        .selectFrom('agent_teams')
        .select(['agent_id'])
        .where('team_id', '=', teamId)
        .execute()
      const teamAgentIds = teamAgentRows.map((row) => row.agent_id)

      const ticketRows =
        teamAgentIds.length > 0
          ? await db
              .selectFrom('tickets')
              .leftJoin('goals', 'goals.id', 'tickets.goal_id')
              .select([
                'tickets.id as id',
                'tickets.title as title',
                'tickets.status as status',
                'tickets.assignee_kind as assignee_kind',
                'tickets.assignee_ref as assignee_ref',
                'goals.title as goal_title',
              ])
              .where('tickets.archived_at', 'is', null)
              .where('tickets.assignee_kind', '=', 'agent')
              .where('tickets.assignee_ref', 'in', teamAgentIds)
              .where('tickets.status', 'in', ['inbox', 'ready', 'in_progress', 'blocked'])
              .orderBy('tickets.updated_at', 'desc')
              .limit(50)
              .execute()
          : []

      // Resolve ticket assignees
      const ticketActorRefs = ticketRows.map((t) => ({
        kind: t.assignee_kind,
        ref: t.assignee_ref,
      }))
      const ticketActors = await resolveActors(ticketActorRefs)

      const tickets = ticketRows.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        assignee: presentActor(t.assignee_kind, t.assignee_ref, ticketActors),
        goalTitle: t.goal_title ?? null,
      }))

      // --- 7. Recent updates ---
      const updateRows = await db
        .selectFrom('work_updates')
        .leftJoin('goals', 'goals.id', 'work_updates.goal_id')
        .leftJoin('tickets', 'tickets.id', 'work_updates.ticket_id')
        .select([
          'work_updates.id as id',
          'work_updates.kind as kind',
          'work_updates.body as body',
          'work_updates.created_at as created_at',
          'work_updates.goal_id as goal_id',
          'work_updates.ticket_id as ticket_id',
          'goals.title as goal_title',
          'tickets.title as ticket_title',
        ])
        .where('work_updates.team_id', '=', teamId)
        .orderBy('work_updates.created_at', 'desc')
        .limit(10)
        .execute()

      const recentUpdates = updateRows.map((row) => ({
        id: row.id,
        kind: row.kind,
        body: row.body,
        createdAt: row.created_at,
        goalId: row.goal_id ?? null,
        goalTitle: row.goal_title ?? null,
        ticketId: row.ticket_id ?? null,
        ticketTitle: row.ticket_title ?? null,
      }))

      // --- 8. Spend ---
      const nowTs = now()
      const [spend7d, spend30d] = await Promise.all([
        getTeamSpendInWindow(teamId, nowTs - 7 * 24 * 3600),
        getTeamSpendInWindow(teamId, nowTs - 30 * 24 * 3600),
      ])

      return {
        team: {
          id: teamRow.id,
          name: teamRow.name,
          charter: teamRow.charter ?? null,
          parentTeamId: teamRow.parent_team_id ?? null,
          parentTeamName,
          lead: teamLead,
          updatedAt: teamRow.updated_at,
        },
        members,
        agents,
        childTeams,
        portfolio,
        goals,
        tickets,
        recentUpdates,
        spend: {
          last7d: spend7d,
          last30d: spend30d,
        },
      }
    }),

  // ---------------------------------------------------------------------------
  // Team CRUD
  // ---------------------------------------------------------------------------

  createTeam: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        parentTeamId: z.string().trim().optional(),
        charter: z.string().trim().max(500).optional(),
        leadUserId: z.string().trim().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const leadId = input.leadUserId ?? userId
      const team = await createTeam({
        name: input.name,
        parent_team_id: input.parentTeamId ?? null,
        charter: input.charter ?? null,
        slug: null,
      })

      // Insert the lead as the first team member (defaults to current user)
      const db = getDb()
      await db
        .insertInto('team_members')
        .values({
          team_id: team.id,
          user_id: leadId,
          role: 'lead',
        })
        .execute()

      return { id: team.id, name: team.name }
    }),

  updateTeam: protectedProcedure
    .input(
      z.object({
        id: z.string().trim().min(1),
        name: z.string().trim().min(1).max(120).optional(),
        charter: z.string().trim().max(2000).optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const existing = await findTeamById(input.id)
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found.' })
      }
      const updated = await updateTeam(input.id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.charter !== undefined ? { charter: input.charter } : {}),
      })
      if (!updated) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update team.' })
      }
      return { id: updated.id, name: updated.name }
    }),

  deleteTeam: protectedProcedure
    .input(z.object({ id: z.string().trim().min(1) }))
    .mutation(async ({ input }) => {
      const existing = await findTeamById(input.id)
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found.' })
      }
      const db = getDb()
      const parentId = existing.parent_team_id ?? null

      await db.transaction().execute(async (trx) => {
        // Reparent child teams up one level
        await trx
          .updateTable('teams')
          .set({ parent_team_id: parentId })
          .where('parent_team_id', '=', input.id)
          .execute()

        // Move agent and user assignments up to parent team
        if (parentId) {
          // Agents: unique on agent_id, so just re-point to parent
          await trx
            .updateTable('agent_teams')
            .set({ team_id: parentId })
            .where('team_id', '=', input.id)
            .execute()

          // Users: composite PK (team_id, user_id) — skip if already in parent
          const memberRows = await trx
            .selectFrom('team_members')
            .select(['user_id', 'role'])
            .where('team_id', '=', input.id)
            .execute()
          const existingMembers = new Set(
            (
              await trx
                .selectFrom('team_members')
                .select('user_id')
                .where('team_id', '=', parentId)
                .execute()
            ).map((r) => r.user_id)
          )
          for (const row of memberRows) {
            if (!existingMembers.has(row.user_id)) {
              await trx
                .insertInto('team_members')
                .values({ team_id: parentId, user_id: row.user_id, role: row.role })
                .execute()
            }
          }
          // Delete old memberships before deleting team
          await trx.deleteFrom('team_members').where('team_id', '=', input.id).execute()
        }

        // Delete agent_teams for this team if no parent (nowhere to move them)
        if (!parentId) {
          await trx.deleteFrom('agent_teams').where('team_id', '=', input.id).execute()
          await trx.deleteFrom('team_members').where('team_id', '=', input.id).execute()
        }

        // Move goals up to parent team (or null if root)
        await trx
          .updateTable('goals')
          .set({ team_id: parentId })
          .where('team_id', '=', input.id)
          .execute()
        // Work updates are historical — just detach
        await trx
          .updateTable('work_updates')
          .set({ team_id: null })
          .where('team_id', '=', input.id)
          .execute()

        // Delete the team itself
        const result = await trx.deleteFrom('teams').where('id', '=', input.id).executeTakeFirst()
        if ((result?.numDeletedRows ?? 0n) === 0n) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete team.' })
        }
      })

      return { ok: true }
    }),

  moveTeam: protectedProcedure
    .input(
      z.object({
        teamId: z.string().trim().min(1),
        newParentTeamId: z.string().trim().nullable(),
        sortOrder: z.number().int().min(0).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb()
      const existing = await findTeamById(input.teamId)
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found.' })
      }
      // Prevent moving a team under itself or its own descendant
      if (input.newParentTeamId) {
        let cursor = input.newParentTeamId
        while (cursor) {
          if (cursor === input.teamId) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'Cannot move a team under itself or its descendant.',
            })
          }
          const parent = await db
            .selectFrom('teams')
            .select('parent_team_id')
            .where('id', '=', cursor)
            .executeTakeFirst()
          cursor = parent?.parent_team_id ?? ''
          if (!cursor) break
        }
      }

      const sortOrder = input.sortOrder ?? 0

      // Shift siblings in target parent to make room
      if (input.newParentTeamId === null) {
        await db
          .updateTable('teams')
          .set((eb) => ({ sort_order: eb('sort_order', '+', 1) }))
          .where('parent_team_id', 'is', null)
          .where('sort_order', '>=', sortOrder)
          .where('id', '!=', input.teamId)
          .execute()
      } else {
        await db
          .updateTable('teams')
          .set((eb) => ({ sort_order: eb('sort_order', '+', 1) }))
          .where('parent_team_id', '=', input.newParentTeamId)
          .where('sort_order', '>=', sortOrder)
          .where('id', '!=', input.teamId)
          .execute()
      }

      const updated = await updateTeam(input.teamId, {
        parent_team_id: input.newParentTeamId,
        sort_order: sortOrder,
      })
      if (!updated) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to move team.' })
      }
      return { ok: true }
    }),

  setTeamLead: protectedProcedure
    .input(
      z.object({
        teamId: z.string().trim().min(1),
        leadKind: z.enum(['user', 'agent']),
        leadRef: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const team = await findTeamById(input.teamId)
      if (!team) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found.' })
      }

      const db = getDb()

      // Update the teams table with lead_kind and lead_ref
      await updateTeam(input.teamId, {
        lead_kind: input.leadKind,
        lead_ref: input.leadRef,
      })

      // For user leads, also manage team_members role
      if (input.leadKind === 'user') {
        // Demote any existing lead to member
        await db
          .updateTable('team_members')
          .set({ role: 'member' })
          .where('team_id', '=', input.teamId)
          .where('role', '=', 'lead')
          .execute()

        // Check if user is already a team member
        const existing = await db
          .selectFrom('team_members')
          .select(['team_id', 'user_id', 'role'])
          .where('team_id', '=', input.teamId)
          .where('user_id', '=', input.leadRef)
          .executeTakeFirst()

        if (existing) {
          // Promote to lead
          await db
            .updateTable('team_members')
            .set({ role: 'lead' })
            .where('team_id', '=', input.teamId)
            .where('user_id', '=', input.leadRef)
            .execute()
        } else {
          // Insert as lead
          await db
            .insertInto('team_members')
            .values({
              team_id: input.teamId,
              user_id: input.leadRef,
              role: 'lead',
            })
            .execute()
        }
      }

      return { ok: true }
    }),

  // ---------------------------------------------------------------------------
  // Agent ↔ Team assignments
  // ---------------------------------------------------------------------------

  addAgentToTeam: protectedProcedure
    .input(
      z.object({
        agentId: z.string().trim().min(1),
        teamId: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb()
      const existingAssignment = await db
        .selectFrom('agent_teams')
        .leftJoin('teams', 'teams.id', 'agent_teams.team_id')
        .select(['agent_teams.team_id as team_id', 'teams.name as team_name'])
        .where('agent_teams.agent_id', '=', input.agentId)
        .executeTakeFirst()

      if (existingAssignment?.team_id === input.teamId) {
        return { ok: true }
      }

      if (existingAssignment?.team_id) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: existingAssignment.team_name
            ? `This agent already belongs to ${existingAssignment.team_name}.`
            : 'This agent already belongs to another team.',
        })
      }

      await addAgentToTeam({
        agent_id: input.agentId,
        team_id: input.teamId,
      })
      return { ok: true }
    }),

  transferAgentToTeam: protectedProcedure
    .input(
      z.object({
        agentId: z.string().trim().min(1),
        teamId: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb()
      const existingAssignment = await db
        .selectFrom('agent_teams')
        .leftJoin('teams', 'teams.id', 'agent_teams.team_id')
        .select(['agent_teams.team_id as team_id', 'teams.name as team_name'])
        .where('agent_teams.agent_id', '=', input.agentId)
        .executeTakeFirst()

      if (existingAssignment?.team_id === input.teamId) {
        return { ok: true, fromTeamName: existingAssignment.team_name ?? null }
      }

      await db.transaction().execute(async (trx) => {
        if (existingAssignment?.team_id) {
          await trx.deleteFrom('agent_teams').where('agent_id', '=', input.agentId).execute()
        }

        await trx
          .insertInto('agent_teams')
          .values({
            agent_id: input.agentId,
            team_id: input.teamId,
            created_at: now(),
          })
          .execute()
      })

      return { ok: true, fromTeamName: existingAssignment?.team_name ?? null }
    }),

  removeAgentFromTeam: protectedProcedure
    .input(
      z.object({
        agentId: z.string().trim().min(1),
        teamId: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const removed = await removeAgentFromTeam(input.agentId, input.teamId)
      if (!removed) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent-team assignment not found.' })
      }
      return { ok: true }
    }),

  // ---------------------------------------------------------------------------
  // Agent list (for assignment combobox)
  // ---------------------------------------------------------------------------

  listAgents: protectedProcedure.query(async () => {
    const db = getDb()
    const agents = await db
      .selectFrom('agents')
      .leftJoin('agent_teams', 'agent_teams.agent_id', 'agents.id')
      .leftJoin('teams', 'teams.id', 'agent_teams.team_id')
      .leftJoin('agent_role_assignments', 'agent_role_assignments.agent_id', 'agents.id')
      .leftJoin('roles', 'roles.id', 'agent_role_assignments.role_id')
      .select([
        'agents.id as id',
        'agents.name as name',
        'agents.handle as handle',
        'agents.config as config',
        'teams.id as team_id',
        'teams.name as team_name',
        'roles.id as role_id',
        'roles.name as role_name',
      ])
      .orderBy('name', 'asc')
      .execute()
    return agents.map((agent) => {
      const parsed = parseAgentConfig(agent.config)
      return {
        id: agent.id,
        name: agent.name,
        handle: agent.handle,
        roleId: agent.role_id ?? null,
        roleName: agent.role_name ?? null,
        emoji: parsed.emoji ?? null,
        teamId: agent.team_id ?? null,
        teamName: agent.team_name ?? null,
      }
    })
  }),

  // ---------------------------------------------------------------------------
  // Roles + layered policy
  // ---------------------------------------------------------------------------

  listRoles: protectedProcedure.query(async () => {
    const [roles, teams, agents] = await Promise.all([
      listRoles(),
      getDb().selectFrom('teams').select(['id', 'name']).orderBy('name', 'asc').execute(),
      getDb()
        .selectFrom('agents')
        .select(['id', 'name', 'handle'])
        .orderBy('name', 'asc')
        .execute(),
    ])

    const [roleGrantsAll, roleDefaultsAll, roleGitHubPoliciesAll, teamDefaults, agentAssignments] =
      await Promise.all([
      Promise.all(
        roles.map(async (role) => ({
          roleId: role.id,
          grants: await listRoleGrants(role.id),
        }))
      ),
      Promise.all(
        roles.map(async (role) => ({
          roleId: role.id,
          defaults: await listRoleDefaults(role.id),
        }))
      ),
      Promise.all(
        roles.map(async (role) => ({
          roleId: role.id,
          githubRepoPolicies: await listRoleGitHubRepoPolicies(role.id),
        }))
      ),
      Promise.all(
        teams.map(async (team) => ({
          teamId: team.id,
          assignments: await listTeamRoleDefaults(team.id),
        }))
      ),
      Promise.all(
        agents.map(async (agent) => ({
          agentId: agent.id,
          assignments: await listAgentRoleAssignments(agent.id),
        }))
      ),
    ])

    const defaultsByRoleId = new Map<string, Array<{ teamId: string; teamName: string }>>()
    for (const row of teamDefaults) {
      const team = teams.find((candidate) => candidate.id === row.teamId)
      if (!team) continue
      for (const assignment of row.assignments) {
        const current = defaultsByRoleId.get(assignment.role.id) ?? []
        current.push({ teamId: team.id, teamName: team.name })
        defaultsByRoleId.set(assignment.role.id, current)
      }
    }

    const agentsByRoleId = new Map<
      string,
      Array<{ agentId: string; agentName: string; handle: string }>
    >()
    for (const row of agentAssignments) {
      const agent = agents.find((candidate) => candidate.id === row.agentId)
      if (!agent) continue
      for (const assignment of row.assignments) {
        const current = agentsByRoleId.get(assignment.role.id) ?? []
        current.push({
          agentId: agent.id,
          agentName: agent.name,
          handle: agent.handle,
        })
        agentsByRoleId.set(assignment.role.id, current)
      }
    }

    const grantsByRoleId = new Map(
      roleGrantsAll.map((row) => [
        row.roleId,
        row.grants.map((grant) => ({
          id: grant.id,
          action: grant.action,
          resourceType: grant.resource_type,
          resourceId: grant.resource_id,
        })),
      ])
    )

    const defaultsDataByRoleId = new Map(
      roleDefaultsAll.map((row) => [
        row.roleId,
        row.defaults.map((entry) => ({
          id: entry.id,
          key: entry.key,
          value: parsePolicyJsonValue(entry.value_json),
        })),
      ])
    )

    const githubRepoPoliciesByRoleId = new Map(
      roleGitHubPoliciesAll.map((row) => [
        row.roleId,
        row.githubRepoPolicies.map((policy) => ({
          githubRepoId: policy.githubRepoId,
          repoFullName: policy.repoFullName,
          repoHtmlUrl: policy.repoHtmlUrl,
          installationAccountLogin: policy.installationAccountLogin,
          capabilities: policy.capabilities,
        })),
      ])
    )

    return roles.map((role) => ({
      id: role.id,
      slug: role.slug,
      name: role.name,
      charter: role.charter,
      escalationPosture: role.escalation_posture,
      active: role.active === 1,
      grants: grantsByRoleId.get(role.id) ?? [],
      defaults: defaultsDataByRoleId.get(role.id) ?? [],
      githubRepoPolicies: githubRepoPoliciesByRoleId.get(role.id) ?? [],
      defaultTeams: defaultsByRoleId.get(role.id) ?? [],
      assignedAgents: agentsByRoleId.get(role.id) ?? [],
    }))
  }),

  getRole: protectedProcedure
    .input(z.object({ roleId: z.string().trim().min(1) }))
    .query(async ({ input }) => {
      const role = await findRoleById(input.roleId)
      if (!role) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found.' })
      }

      const [grants, defaults, githubRepoPolicies, allTeams, allAgents] = await Promise.all([
        listRoleGrants(role.id),
        listRoleDefaults(role.id),
        listRoleGitHubRepoPolicies(role.id),
        getDb().selectFrom('teams').select(['id', 'name']).orderBy('name', 'asc').execute(),
        getDb()
          .selectFrom('agents')
          .select(['id', 'name', 'handle'])
          .orderBy('name', 'asc')
          .execute(),
      ])

      const [teamDefaults, agentAssignments] = await Promise.all([
        Promise.all(
          allTeams.map(async (team) => ({
            team,
            assignments: await listTeamRoleDefaults(team.id),
          }))
        ),
        Promise.all(
          allAgents.map(async (agent) => ({
            agent,
            assignments: await listAgentRoleAssignments(agent.id),
          }))
        ),
      ])

      return {
        id: role.id,
        slug: role.slug,
        name: role.name,
        charter: role.charter,
        escalationPosture: role.escalation_posture,
        active: role.active === 1,
        grants: grants.map((grant) => ({
          id: grant.id,
          action: grant.action,
          resourceType: grant.resource_type,
          resourceId: grant.resource_id,
        })),
        defaults: defaults.map((entry) => ({
          id: entry.id,
          key: entry.key,
          value: parsePolicyJsonValue(entry.value_json),
        })),
        githubRepoPolicies: githubRepoPolicies.map((policy) => ({
          githubRepoId: policy.githubRepoId,
          repoFullName: policy.repoFullName,
          repoHtmlUrl: policy.repoHtmlUrl,
          installationAccountLogin: policy.installationAccountLogin,
          capabilities: policy.capabilities,
        })),
        defaultTeams: teamDefaults
          .filter((row) => row.assignments.some((assignment) => assignment.role.id === role.id))
          .map((row) => ({ id: row.team.id, name: row.team.name })),
        assignedAgents: agentAssignments
          .filter((row) => row.assignments.some((assignment) => assignment.role.id === role.id))
          .map((row) => ({
            id: row.agent.id,
            name: row.agent.name,
            handle: row.agent.handle,
          })),
      }
    }),

  createRole: protectedProcedure
    .input(
      z.object({
        slug: z.string().trim().min(1),
        name: z.string().trim().min(1),
        charter: z.string().trim().optional().nullable(),
        escalationPosture: z.string().trim().optional().nullable(),
        active: z.boolean().optional(),
        grants: z.array(policyGrantInputSchema).optional(),
        defaults: z.array(policyDefaultInputSchema).optional(),
        githubRepoPolicies: z.array(roleGitHubRepoPolicyInputSchema).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const role = await createRole({
        slug: input.slug,
        name: input.name,
        charter: input.charter ?? null,
        escalation_posture: input.escalationPosture ?? null,
        active: input.active === false ? 0 : 1,
      })
      if (input.grants) {
        await replaceRoleGrants(
          role.id,
          input.grants.map((grant) => ({
            action: grant.action,
            resource_type: grant.resourceType ?? null,
            resource_id: grant.resourceId ?? null,
          }))
        )
      }
      if (input.defaults) {
        await replaceRoleDefaults(
          role.id,
          input.defaults.map((entry) => ({
            key: entry.key,
            value_json: JSON.stringify(entry.value),
          }))
        )
      }
      if (input.githubRepoPolicies) {
        await replaceRoleGitHubRepoPolicies(role.id, input.githubRepoPolicies)
      }
      await writePolicyAuditLog({
        eventType: 'POLICY_ROLE_CREATED',
        capability: 'policy.write',
        result: 'allowed',
        metadata: {
          actorUserId: requireUserId(ctx.session),
          roleId: role.id,
        },
      })
      return { id: role.id }
    }),

  updateRole: protectedProcedure
    .input(
      z.object({
        roleId: z.string().trim().min(1),
        slug: z.string().trim().min(1).optional(),
        name: z.string().trim().min(1).optional(),
        charter: z.string().trim().optional().nullable(),
        escalationPosture: z.string().trim().optional().nullable(),
        active: z.boolean().optional(),
        grants: z.array(policyGrantInputSchema).optional(),
        defaults: z.array(policyDefaultInputSchema).optional(),
        githubRepoPolicies: z.array(roleGitHubRepoPolicyInputSchema).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const role = await findRoleById(input.roleId)
      if (!role) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found.' })
      }
      await updateRole(role.id, {
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.charter !== undefined ? { charter: input.charter } : {}),
        ...(input.escalationPosture !== undefined
          ? { escalation_posture: input.escalationPosture }
          : {}),
        ...(input.active !== undefined ? { active: input.active ? 1 : 0 } : {}),
      })
      if (input.grants) {
        await replaceRoleGrants(
          role.id,
          input.grants.map((grant) => ({
            action: grant.action,
            resource_type: grant.resourceType ?? null,
            resource_id: grant.resourceId ?? null,
          }))
        )
      }
      if (input.defaults) {
        await replaceRoleDefaults(
          role.id,
          input.defaults.map((entry) => ({
            key: entry.key,
            value_json: JSON.stringify(entry.value),
          }))
        )
      }
      if (input.githubRepoPolicies) {
        await replaceRoleGitHubRepoPolicies(role.id, input.githubRepoPolicies)
      }
      await writePolicyAuditLog({
        eventType: 'POLICY_ROLE_UPDATED',
        capability: 'policy.write',
        result: 'allowed',
        metadata: {
          actorUserId: requireUserId(ctx.session),
          roleId: role.id,
        },
      })
      return { ok: true }
    }),

  deleteRole: protectedProcedure
    .input(z.object({ roleId: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const role = await findRoleById(input.roleId)
      if (!role) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found.' })
      }

      const deleted = await deleteRoleRecord(role.id)
      if (!deleted) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete role.' })
      }

      await writePolicyAuditLog({
        eventType: 'POLICY_ROLE_DELETED',
        capability: 'policy.write',
        result: 'allowed',
        metadata: {
          actorUserId: requireUserId(ctx.session),
          roleId: role.id,
          roleSlug: role.slug,
        },
      })

      return { ok: true }
    }),

  assignRoleToAgent: protectedProcedure
    .input(
      z.object({
        roleId: z.string().trim().min(1),
        agentId: z.string().trim().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [role, agent] = await Promise.all([
        findRoleById(input.roleId),
        findAgentById(input.agentId),
      ])
      if (!role || !agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Role or agent not found.' })
      }
      await assignRoleToAgent(agent.id, role.id)
      await writePolicyAuditLog({
        eventType: 'POLICY_ROLE_ASSIGNED_TO_AGENT',
        capability: 'policy.write',
        result: 'allowed',
        metadata: {
          actorUserId: requireUserId(ctx.session),
          roleId: role.id,
          agentId: agent.id,
        },
      })
      return { ok: true }
    }),

  removeRoleFromAgent: protectedProcedure
    .input(
      z.object({
        roleId: z.string().trim().min(1),
        agentId: z.string().trim().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const removed = await removeRoleFromAgent(input.agentId, input.roleId)
      if (!removed) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Role assignment not found.' })
      }
      await writePolicyAuditLog({
        eventType: 'POLICY_ROLE_REMOVED_FROM_AGENT',
        capability: 'policy.write',
        result: 'allowed',
        metadata: {
          actorUserId: requireUserId(ctx.session),
          roleId: input.roleId,
          agentId: input.agentId,
        },
      })
      return { ok: true }
    }),

  assignDefaultRoleToTeam: protectedProcedure
    .input(
      z.object({
        roleId: z.string().trim().min(1),
        teamId: z.string().trim().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [role, team] = await Promise.all([
        findRoleById(input.roleId),
        findTeamById(input.teamId),
      ])
      if (!role || !team) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Role or team not found.' })
      }
      await assignDefaultRoleToTeam(team.id, role.id)
      await writePolicyAuditLog({
        eventType: 'POLICY_ROLE_ASSIGNED_TO_TEAM_DEFAULT',
        capability: 'policy.write',
        result: 'allowed',
        metadata: {
          actorUserId: requireUserId(ctx.session),
          roleId: role.id,
          teamId: team.id,
        },
      })
      return { ok: true }
    }),

  removeDefaultRoleFromTeam: protectedProcedure
    .input(
      z.object({
        roleId: z.string().trim().min(1),
        teamId: z.string().trim().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const removed = await removeDefaultRoleFromTeam(input.teamId, input.roleId)
      if (!removed) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Team default role not found.' })
      }
      await writePolicyAuditLog({
        eventType: 'POLICY_ROLE_REMOVED_FROM_TEAM_DEFAULT',
        capability: 'policy.write',
        result: 'allowed',
        metadata: {
          actorUserId: requireUserId(ctx.session),
          roleId: input.roleId,
          teamId: input.teamId,
        },
      })
      return { ok: true }
    }),

  getAgentPolicy: protectedProcedure
    .input(z.object({ agentId: z.string().trim().min(1) }))
    .query(async ({ input }) => {
      const agent = await findAgentById(input.agentId)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found.' })
      }

      const [resolved, roleAssignments] = await Promise.all([
        resolveEffectivePolicy(agent.id),
        listAgentRoleAssignments(agent.id),
      ])

      return {
        agent: {
          id: agent.id,
          name: agent.name,
          handle: agent.handle,
          status: agent.status,
        },
        assignedRoles: roleAssignments.map((assignment) => ({
          id: assignment.role.id,
          slug: assignment.role.slug,
          name: assignment.role.name,
          charter: assignment.role.charter,
          escalationPosture: assignment.role.escalation_posture,
        })),
        effectiveRoles: resolved.roles,
        effectiveGrants: resolved.grants,
        effectiveDefaults: resolved.defaults,
      }
    }),

  listUsers: protectedProcedure.query(async () => {
    const db = getDb()
    const users = await db
      .selectFrom('users')
      .select(['id', 'name', 'email', 'avatar_url'])
      .orderBy('name', 'asc')
      .execute()
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatar_url,
    }))
  }),
})
