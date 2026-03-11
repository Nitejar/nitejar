import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '../db'
import {
  createGoal,
  createTicket,
  createWorkUpdate,
  createWorkView,
  deleteWorkView,
  getCompanyOverviewRollup,
  listAgentWorkloadRollups,
  listGoalCoverageRollups,
  listGoalHealthSummaries,
  listGoals,
  listTeamPortfolioRollups,
  listTickets,
  listTicketWorkloadRollups,
  listWorkViews,
  updateWorkView,
} from './work'

let testDir = ''
let db: ReturnType<typeof getDb>

async function createSchema(database: ReturnType<typeof getDb>): Promise<void> {
  await database.schema
    .createTable('users')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('name', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('updated_at', 'text', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('teams')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('charter', 'text')
    .addColumn('slug', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('team_members')
    .ifNotExists()
    .addColumn('team_id', 'text', (col) => col.notNull())
    .addColumn('user_id', 'text', (col) => col.notNull())
    .addColumn('role', 'text', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('agent_teams')
    .ifNotExists()
    .addColumn('team_id', 'text', (col) => col.notNull())
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('is_primary', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('goals')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('parent_goal_id', 'text')
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('outcome', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('owner_kind', 'text')
    .addColumn('owner_ref', 'text')
    .addColumn('team_id', 'text')
    .addColumn('created_by_user_id', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addColumn('archived_at', 'integer')
    .execute()

  await database.schema
    .createTable('goal_agent_allocations')
    .ifNotExists()
    .addColumn('goal_id', 'text', (col) => col.notNull())
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('created_by_kind', 'text', (col) => col.notNull())
    .addColumn('created_by_ref', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('tickets')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('goal_id', 'text')
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('body', 'text')
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('assignee_kind', 'text')
    .addColumn('assignee_ref', 'text')
    .addColumn('created_by_user_id', 'text')
    .addColumn('claimed_by_kind', 'text')
    .addColumn('claimed_by_ref', 'text')
    .addColumn('claimed_at', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addColumn('archived_at', 'integer')
    .execute()

  await database.schema
    .createTable('work_views')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('owner_user_id', 'text', (col) => col.notNull())
    .addColumn('scope', 'text', (col) => col.notNull())
    .addColumn('entity_kind', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('filters_json', 'text', (col) => col.notNull())
    .addColumn('sort_json', 'text')
    .addColumn('group_by', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('work_updates')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('goal_id', 'text')
    .addColumn('ticket_id', 'text')
    .addColumn('team_id', 'text')
    .addColumn('author_kind', 'text', (col) => col.notNull())
    .addColumn('author_ref', 'text')
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('body', 'text', (col) => col.notNull())
    .addColumn('metadata_json', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()
}

async function clearTables(database: ReturnType<typeof getDb>): Promise<void> {
  await database.deleteFrom('work_updates').execute()
  await database.deleteFrom('work_views').execute()
  await database.deleteFrom('goal_agent_allocations').execute()
  await database.deleteFrom('agent_teams').execute()
  await database.deleteFrom('team_members').execute()
  await database.deleteFrom('teams').execute()
  await database.deleteFrom('tickets').execute()
  await database.deleteFrom('goals').execute()
  await database.deleteFrom('users').execute()
}

async function seedUser(): Promise<void> {
  await db
    .insertInto('users')
    .values({
      id: 'user-1',
      email: 'josh@example.com',
      name: 'Josh',
      created_at: '2026-03-08T00:00:00.000Z',
      updated_at: '2026-03-08T00:00:00.000Z',
    })
    .execute()
}

describe('work repository', () => {
  beforeAll(async () => {
    await closeDb()
    testDir = mkdtempSync(join(tmpdir(), 'nitejar-work-repo-'))
    process.env.DATABASE_URL = join(testDir, 'test.sqlite')
    db = getDb()
    await createSchema(db)
  })

  afterAll(async () => {
    await closeDb()
    delete process.env.DATABASE_URL
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await clearTables(db)
    await seedUser()
  })

  it('creates, updates, lists, and deletes work views', async () => {
    const created = await createWorkView({
      owner_user_id: 'user-1',
      scope: 'user',
      entity_kind: 'ticket',
      name: 'My Queue',
      filters_json: JSON.stringify({ scope: 'mine' }),
      sort_json: JSON.stringify({ field: 'updated_at', direction: 'desc' }),
      group_by: null,
    })

    expect(created.name).toBe('My Queue')

    const updated = await updateWorkView(created.id, {
      name: 'Blocked Queue',
      filters_json: JSON.stringify({ scope: 'all', statuses: ['blocked'] }),
      sort_json: JSON.stringify({ field: 'status', direction: 'asc' }),
      group_by: 'status',
    })

    expect(updated?.name).toBe('Blocked Queue')
    expect(updated?.group_by).toBe('status')

    const listed = await listWorkViews({
      ownerUserId: 'user-1',
      entityKind: 'ticket',
    })

    expect(listed).toHaveLength(1)
    expect(listed[0]?.name).toBe('Blocked Queue')

    await expect(deleteWorkView(created.id, 'user-1')).resolves.toBe(true)
    await expect(
      listWorkViews({
        ownerUserId: 'user-1',
        entityKind: 'ticket',
      })
    ).resolves.toHaveLength(0)
  })

  it('sorts goals using the requested sort field', async () => {
    const beta = await createGoal({
      parent_goal_id: null,
      title: 'Beta Goal',
      outcome: 'Second alphabetically.',
      status: 'active',
      owner_kind: 'user',
      owner_ref: 'user-1',
      created_by_user_id: 'user-1',
      archived_at: null,
    })
    const alpha = await createGoal({
      parent_goal_id: null,
      title: 'Alpha Goal',
      outcome: 'First alphabetically.',
      status: 'blocked',
      owner_kind: 'user',
      owner_ref: 'user-1',
      created_by_user_id: 'user-1',
      archived_at: null,
    })

    await db.updateTable('goals').set({ updated_at: 10 }).where('id', '=', beta.id).execute()
    await db.updateTable('goals').set({ updated_at: 20 }).where('id', '=', alpha.id).execute()

    const byTitle = await listGoals({
      sortBy: 'title',
      sortDirection: 'asc',
    })

    expect(byTitle.map((goal) => goal.title)).toEqual(['Alpha Goal', 'Beta Goal'])
  })

  it('filters stale tickets and respects explicit sort order', async () => {
    const goal = await createGoal({
      parent_goal_id: null,
      title: 'Ship work views',
      outcome: 'Saved views exist.',
      status: 'active',
      owner_kind: 'user',
      owner_ref: 'user-1',
      created_by_user_id: 'user-1',
      archived_at: null,
    })

    const ready = await createTicket({
      goal_id: goal.id,
      title: 'Newest ready ticket',
      body: null,
      status: 'ready',
      assignee_kind: 'user',
      assignee_ref: 'user-1',
      created_by_user_id: 'user-1',
      claimed_by_kind: null,
      claimed_by_ref: null,
      claimed_at: null,
      archived_at: null,
    })
    const blocked = await createTicket({
      goal_id: goal.id,
      title: 'Older blocked ticket',
      body: null,
      status: 'blocked',
      assignee_kind: 'user',
      assignee_ref: 'user-1',
      created_by_user_id: 'user-1',
      claimed_by_kind: null,
      claimed_by_ref: null,
      claimed_at: null,
      archived_at: null,
    })

    await db.updateTable('tickets').set({ updated_at: 30 }).where('id', '=', ready.id).execute()
    await db.updateTable('tickets').set({ updated_at: 5 }).where('id', '=', blocked.id).execute()

    const stale = await listTickets({
      staleBefore: 10,
      sortBy: 'status',
      sortDirection: 'asc',
    })

    expect(stale).toHaveLength(1)
    expect(stale[0]?.title).toBe('Older blocked ticket')
    expect(stale[0]?.status).toBe('blocked')
  })

  it('builds workload rollups for assignees and agents', async () => {
    const goal = await createGoal({
      parent_goal_id: null,
      title: 'Stabilize queue',
      outcome: 'Workload is visible.',
      status: 'active',
      owner_kind: 'agent',
      owner_ref: 'agent-1',
      created_by_user_id: 'user-1',
      archived_at: null,
    })

    await createTicket({
      goal_id: goal.id,
      title: 'Blocked ticket',
      body: null,
      status: 'blocked',
      assignee_kind: 'agent',
      assignee_ref: 'agent-1',
      created_by_user_id: 'user-1',
      claimed_by_kind: 'user',
      claimed_by_ref: 'user-1',
      claimed_at: 10,
      archived_at: null,
    })
    await createTicket({
      goal_id: goal.id,
      title: 'Ready ticket',
      body: null,
      status: 'ready',
      assignee_kind: 'agent',
      assignee_ref: 'agent-1',
      created_by_user_id: 'user-1',
      claimed_by_kind: 'user',
      claimed_by_ref: 'user-1',
      claimed_at: 11,
      archived_at: null,
    })
    await createTicket({
      goal_id: goal.id,
      title: 'Queued for agent-2',
      body: null,
      status: 'inbox',
      assignee_kind: 'agent',
      assignee_ref: 'agent-2',
      created_by_user_id: 'user-1',
      claimed_by_kind: null,
      claimed_by_ref: null,
      claimed_at: null,
      archived_at: null,
    })
    await createTicket({
      goal_id: goal.id,
      title: 'Recent done',
      body: null,
      status: 'done',
      assignee_kind: 'agent',
      assignee_ref: 'agent-1',
      created_by_user_id: 'user-1',
      claimed_by_kind: 'user',
      claimed_by_ref: 'user-1',
      claimed_at: 12,
      archived_at: null,
    })

    const workload = await listTicketWorkloadRollups()
    const agentQueue = workload.find((entry) => entry.assignee_ref === 'agent-1')
    const agent2Queue = workload.find((entry) => entry.assignee_ref === 'agent-2')

    expect(agentQueue?.open_count).toBe(3)
    expect(agentQueue?.blocked_count).toBe(1)
    expect(agent2Queue?.inbox_count).toBe(1)

    const agentRollups = await listAgentWorkloadRollups({
      agentIds: ['agent-1'],
      recentDoneSince: 0,
    })

    expect(agentRollups).toHaveLength(1)
    expect(agentRollups[0]?.open_ticket_count).toBe(2)
    expect(agentRollups[0]?.blocked_ticket_count).toBe(1)
    expect(agentRollups[0]?.recent_done_ticket_count).toBe(1)
    expect(agentRollups[0]?.owned_goal_count).toBe(1)
  })

  it('derives goal health, heartbeat freshness, and stale signals', async () => {
    const goal = await createGoal({
      parent_goal_id: null,
      title: 'Weekly planning',
      outcome: 'Heartbeat reflects stale planning risk.',
      status: 'active',
      owner_kind: 'user',
      owner_ref: 'user-1',
      created_by_user_id: 'user-1',
      archived_at: null,
    })

    const blocked = await createTicket({
      goal_id: goal.id,
      title: 'Blocked follow-up',
      body: null,
      status: 'blocked',
      assignee_kind: 'user',
      assignee_ref: 'user-1',
      created_by_user_id: 'user-1',
      claimed_by_kind: 'user',
      claimed_by_ref: 'user-1',
      claimed_at: 10,
      archived_at: null,
    })

    await db.updateTable('goals').set({ updated_at: 100 }).where('id', '=', goal.id).execute()
    await db.updateTable('tickets').set({ updated_at: 110 }).where('id', '=', blocked.id).execute()

    const withoutHeartbeat = await listGoalHealthSummaries({
      goalIds: [goal.id],
      activityStaleAfterSeconds: 10,
      heartbeatStaleAfterSeconds: 10,
    })

    expect(withoutHeartbeat[0]?.health).toBe('blocked')
    expect(withoutHeartbeat[0]?.is_stale).toBe(true)

    await createWorkUpdate({
      goal_id: goal.id,
      ticket_id: null,
      team_id: null,
      author_kind: 'user',
      author_ref: 'user-1',
      kind: 'heartbeat',
      body: 'Still moving, blocker is understood.',
      metadata_json: null,
    })

    const withHeartbeat = await listGoalHealthSummaries({
      goalIds: [goal.id],
      activityStaleAfterSeconds: 10_000,
      heartbeatStaleAfterSeconds: 10_000,
    })

    expect(withHeartbeat[0]?.last_heartbeat_at).toBeTruthy()
    expect(withHeartbeat[0]?.is_stale).toBe(false)
    expect(withHeartbeat[0]?.blocked_count).toBe(1)
  })

  it('builds company goal coverage and overview rollups', async () => {
    await db
      .insertInto('teams')
      .values([
        {
          id: 'team-ops',
          name: 'Ops',
          charter: 'Keep the company moving.',
          slug: 'ops',
          created_at: 1,
          updated_at: 1,
        },
        {
          id: 'team-eng',
          name: 'Engineering',
          charter: 'Build the product.',
          slug: 'engineering',
          created_at: 1,
          updated_at: 1,
        },
      ])
      .execute()

    await db
      .insertInto('agent_teams')
      .values([
        { team_id: 'team-ops', agent_id: 'agent-1', is_primary: 1, created_at: 1 },
        { team_id: 'team-eng', agent_id: 'agent-2', is_primary: 1, created_at: 1 },
      ])
      .execute()

    const coveredGoal = await createGoal({
      parent_goal_id: null,
      title: 'Run onboarding',
      outcome: 'The company can onboard itself.',
      status: 'active',
      owner_kind: 'agent',
      owner_ref: 'agent-1',
      created_by_user_id: 'user-1',
      archived_at: null,
    })
    const thinGoal = await createGoal({
      parent_goal_id: null,
      title: 'Handle support queue',
      outcome: 'Support stays under control.',
      status: 'active',
      owner_kind: 'agent',
      owner_ref: 'agent-3',
      created_by_user_id: 'user-1',
      archived_at: null,
    })
    const overloadedGoal = await createGoal({
      parent_goal_id: null,
      title: 'Ship the product',
      outcome: 'Engineering stays unblocked.',
      status: 'active',
      owner_kind: 'agent',
      owner_ref: 'agent-2',
      created_by_user_id: 'user-1',
      archived_at: null,
    })
    const unstaffedGoal = await createGoal({
      parent_goal_id: null,
      title: 'Open a new market',
      outcome: 'A new growth bet exists.',
      status: 'active',
      owner_kind: null,
      owner_ref: null,
      created_by_user_id: 'user-1',
      archived_at: null,
    })

    await createTicket({
      goal_id: coveredGoal.id,
      title: 'Coordinate the launch',
      body: null,
      status: 'in_progress',
      assignee_kind: 'agent',
      assignee_ref: 'agent-1',
      created_by_user_id: 'user-1',
      claimed_by_kind: 'user',
      claimed_by_ref: 'user-1',
      claimed_at: 5,
      archived_at: null,
    })

    await createTicket({
      goal_id: thinGoal.id,
      title: 'Queue work for Ops',
      body: null,
      status: 'ready',
      assignee_kind: 'agent',
      assignee_ref: 'agent-3',
      created_by_user_id: 'user-1',
      claimed_by_kind: null,
      claimed_by_ref: null,
      claimed_at: null,
      archived_at: null,
    })

    for (const title of [
      'Fix build',
      'Fix tests',
      'Fix regressions',
      'Fix deploy',
      'Fix docs',
      'Fix release',
    ]) {
      await createTicket({
        goal_id: overloadedGoal.id,
        title,
        body: null,
        status: 'in_progress',
        assignee_kind: 'agent',
        assignee_ref: 'agent-2',
        created_by_user_id: 'user-1',
        claimed_by_kind: 'user',
        claimed_by_ref: 'user-1',
        claimed_at: 6,
        archived_at: null,
      })
    }

    const coverage = await listGoalCoverageRollups()
    const byId = new Map(coverage.map((row) => [row.goal_id, row]))

    expect(byId.get(coveredGoal.id)?.coverage_status).toBe('covered')
    expect(byId.get(thinGoal.id)?.coverage_status).toBe('thin')
    expect(byId.get(overloadedGoal.id)?.coverage_status).toBe('overloaded')
    expect(byId.get(unstaffedGoal.id)?.coverage_status).toBe('unstaffed')
    expect(byId.get(coveredGoal.id)?.primary_team_id).toBe('team-ops')

    const overview = await getCompanyOverviewRollup()

    expect(overview.active_goal_count).toBe(4)
    expect(overview.staffed_goal_count).toBe(3)
    expect(overview.unstaffed_goal_count).toBe(1)
    expect(overview.thin_goal_count).toBe(1)
    expect(overview.overloaded_goal_count).toBe(1)
    expect(overview.active_team_count).toBe(2)
    expect(overview.overloaded_agent_count).toBe(1)
  })

  it('builds team portfolio rollups from active goals and staffing gaps', async () => {
    await db
      .insertInto('teams')
      .values({
        id: 'team-ops',
        name: 'Ops',
        charter: 'Keep the company moving.',
        slug: 'ops',
        created_at: 1,
        updated_at: 1,
      })
      .execute()

    await db
      .insertInto('team_members')
      .values({
        team_id: 'team-ops',
        user_id: 'user-1',
        role: 'lead',
        created_at: 1,
      })
      .execute()

    await db
      .insertInto('agent_teams')
      .values([
        { team_id: 'team-ops', agent_id: 'agent-1', is_primary: 1, created_at: 1 },
        { team_id: 'team-ops', agent_id: 'agent-2', is_primary: 0, created_at: 1 },
      ])
      .execute()

    const staffedGoal = await createGoal({
      parent_goal_id: null,
      title: 'Operate the queue',
      outcome: 'Ops covers daily work.',
      status: 'active',
      owner_kind: 'agent',
      owner_ref: 'agent-1',
      created_by_user_id: 'user-1',
      archived_at: null,
    })
    const thinGoal = await createGoal({
      parent_goal_id: null,
      title: 'Respond to approvals',
      outcome: 'Approvals do not back up.',
      status: 'active',
      owner_kind: 'agent',
      owner_ref: 'agent-2',
      created_by_user_id: 'user-1',
      archived_at: null,
    })

    await createTicket({
      goal_id: staffedGoal.id,
      title: 'Run the morning queue',
      body: null,
      status: 'in_progress',
      assignee_kind: 'agent',
      assignee_ref: 'agent-1',
      created_by_user_id: 'user-1',
      claimed_by_kind: 'user',
      claimed_by_ref: 'user-1',
      claimed_at: 4,
      archived_at: null,
    })
    await createTicket({
      goal_id: thinGoal.id,
      title: 'Wait for Ops claim',
      body: null,
      status: 'blocked',
      assignee_kind: 'agent',
      assignee_ref: 'agent-2',
      created_by_user_id: 'user-1',
      claimed_by_kind: null,
      claimed_by_ref: null,
      claimed_at: null,
      archived_at: null,
    })

    await createWorkUpdate({
      goal_id: null,
      ticket_id: null,
      team_id: 'team-ops',
      author_kind: 'agent',
      author_ref: 'agent-1',
      kind: 'heartbeat',
      body: 'Ops is carrying the queue.',
      metadata_json: null,
    })

    const rollups = await listTeamPortfolioRollups()

    expect(rollups).toHaveLength(1)
    expect(rollups[0]?.team_id).toBe('team-ops')
    expect(rollups[0]?.member_count).toBe(1)
    expect(rollups[0]?.agent_count).toBe(2)
    expect(rollups[0]?.primary_agent_count).toBe(1)
    expect(rollups[0]?.active_goal_count).toBe(2)
    expect(rollups[0]?.blocked_goal_count).toBe(1)
    expect(rollups[0]?.queued_ticket_count).toBe(1)
    expect(rollups[0]?.blocked_ticket_count).toBe(1)
    expect(rollups[0]?.goals_needing_staffing_count).toBe(1)
    expect(rollups[0]?.latest_heartbeat_at).toBeTruthy()
  })
})
