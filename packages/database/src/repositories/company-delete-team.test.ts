import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '../db'
import { sql } from 'kysely'
import { addAgentToTeam, createTeam, findTeamById } from './work'

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
    .addColumn('parent_team_id', 'text')
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('charter', 'text')
    .addColumn('slug', 'text')
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('lead_kind', 'text')
    .addColumn('lead_ref', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('team_members')
    .ifNotExists()
    .addColumn('team_id', 'text', (col) => col.notNull())
    .addColumn('user_id', 'text', (col) => col.notNull())
    .addColumn('role', 'text', (col) => col.notNull().defaultTo('member'))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()

  // Composite PK on team_members
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_team_member_pk ON team_members(team_id, user_id)`.execute(
    database
  )

  await database.schema
    .createTable('agent_teams')
    .ifNotExists()
    .addColumn('team_id', 'text', (col) => col.notNull())
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('is_primary', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()

  // Unique: one team per agent
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_one_team ON agent_teams(agent_id)`.execute(
    database
  )
}

async function clearTables(database: ReturnType<typeof getDb>): Promise<void> {
  await database.deleteFrom('agent_teams').execute()
  await database.deleteFrom('team_members').execute()
  await database.deleteFrom('teams').execute()
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
  await db
    .insertInto('users')
    .values({
      id: 'user-2',
      email: 'alex@example.com',
      name: 'Alex',
      created_at: '2026-03-08T00:00:00.000Z',
      updated_at: '2026-03-08T00:00:00.000Z',
    })
    .execute()
}

/**
 * Replicates the deleteTeam transaction logic from apps/web/server/routers/company.ts.
 * This is the unit under test — the same transaction body the tRPC procedure runs.
 */
async function deleteTeamWithReparent(teamId: string): Promise<void> {
  const existing = await findTeamById(teamId)
  if (!existing) throw new Error('Team not found')

  const parentId = existing.parent_team_id ?? null

  await db.transaction().execute(async (trx) => {
    // Reparent child teams up one level
    await trx
      .updateTable('teams')
      .set({ parent_team_id: parentId })
      .where('parent_team_id', '=', teamId)
      .execute()

    // Move agent and user assignments up to parent team
    if (parentId) {
      // Agents: unique on agent_id, so just re-point to parent
      await trx
        .updateTable('agent_teams')
        .set({ team_id: parentId })
        .where('team_id', '=', teamId)
        .execute()

      // Users: composite PK (team_id, user_id) — skip if already in parent
      const memberRows = await trx
        .selectFrom('team_members')
        .select(['user_id', 'role'])
        .where('team_id', '=', teamId)
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
      await trx.deleteFrom('team_members').where('team_id', '=', teamId).execute()
    }

    // Delete agent_teams for this team if no parent (nowhere to move them)
    if (!parentId) {
      await trx.deleteFrom('agent_teams').where('team_id', '=', teamId).execute()
      await trx.deleteFrom('team_members').where('team_id', '=', teamId).execute()
    }

    // Delete the team itself
    const result = await trx.deleteFrom('teams').where('id', '=', teamId).executeTakeFirst()
    if ((result?.numDeletedRows ?? 0n) === 0n) {
      throw new Error('Failed to delete team.')
    }
  })
}

describe('deleteTeam transaction', () => {
  beforeAll(async () => {
    await closeDb()
    testDir = mkdtempSync(join(tmpdir(), 'nitejar-delete-team-'))
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

  it('deletes a leaf team and moves agents and members to parent', async () => {
    const parent = await createTeam({
      name: 'Engineering',
      parent_team_id: null,
      charter: null,
      slug: 'engineering',
    })
    const leaf = await createTeam({
      name: 'Frontend',
      parent_team_id: parent.id,
      charter: null,
      slug: 'frontend',
    })

    await addAgentToTeam({ agent_id: 'agent-1', team_id: leaf.id, is_primary: 1 })
    await db
      .insertInto('team_members')
      .values({ team_id: leaf.id, user_id: 'user-1', role: 'member' })
      .execute()

    await deleteTeamWithReparent(leaf.id)

    // Leaf team should be gone
    expect(await findTeamById(leaf.id)).toBeNull()

    // Agent should now belong to parent
    const agentRow = await db
      .selectFrom('agent_teams')
      .selectAll()
      .where('agent_id', '=', 'agent-1')
      .executeTakeFirst()
    expect(agentRow?.team_id).toBe(parent.id)

    // User should now be a member of parent
    const memberRow = await db
      .selectFrom('team_members')
      .selectAll()
      .where('user_id', '=', 'user-1')
      .executeTakeFirst()
    expect(memberRow?.team_id).toBe(parent.id)
  })

  it('deletes a middle team, reparents children, and moves agents to parent', async () => {
    const grandparent = await createTeam({
      name: 'Company',
      parent_team_id: null,
      charter: null,
      slug: 'company',
    })
    const middle = await createTeam({
      name: 'Engineering',
      parent_team_id: grandparent.id,
      charter: null,
      slug: 'engineering',
    })
    const childA = await createTeam({
      name: 'Frontend',
      parent_team_id: middle.id,
      charter: null,
      slug: 'frontend',
    })
    const childB = await createTeam({
      name: 'Backend',
      parent_team_id: middle.id,
      charter: null,
      slug: 'backend',
    })

    await addAgentToTeam({ agent_id: 'agent-1', team_id: middle.id, is_primary: 1 })
    await db
      .insertInto('team_members')
      .values({ team_id: middle.id, user_id: 'user-1', role: 'lead' })
      .execute()

    await deleteTeamWithReparent(middle.id)

    // Middle team should be gone
    expect(await findTeamById(middle.id)).toBeNull()

    // Children should now point to grandparent
    const updatedChildA = await findTeamById(childA.id)
    const updatedChildB = await findTeamById(childB.id)
    expect(updatedChildA?.parent_team_id).toBe(grandparent.id)
    expect(updatedChildB?.parent_team_id).toBe(grandparent.id)

    // Agent should be in grandparent
    const agentRow = await db
      .selectFrom('agent_teams')
      .selectAll()
      .where('agent_id', '=', 'agent-1')
      .executeTakeFirst()
    expect(agentRow?.team_id).toBe(grandparent.id)

    // User should be in grandparent
    const memberRow = await db
      .selectFrom('team_members')
      .selectAll()
      .where('user_id', '=', 'user-1')
      .executeTakeFirst()
    expect(memberRow?.team_id).toBe(grandparent.id)
  })

  it('deletes a root team — children become root, agents and members are removed', async () => {
    const root = await createTeam({
      name: 'Root',
      parent_team_id: null,
      charter: null,
      slug: 'root',
    })
    const child = await createTeam({
      name: 'Child',
      parent_team_id: root.id,
      charter: null,
      slug: 'child',
    })

    await addAgentToTeam({ agent_id: 'agent-1', team_id: root.id, is_primary: 1 })
    await db
      .insertInto('team_members')
      .values({ team_id: root.id, user_id: 'user-1', role: 'member' })
      .execute()

    await deleteTeamWithReparent(root.id)

    // Root team should be gone
    expect(await findTeamById(root.id)).toBeNull()

    // Child should now be a root team (null parent)
    const updatedChild = await findTeamById(child.id)
    expect(updatedChild?.parent_team_id).toBeNull()

    // Agent assignment should be removed entirely (no parent to move to)
    const agentRow = await db
      .selectFrom('agent_teams')
      .selectAll()
      .where('agent_id', '=', 'agent-1')
      .executeTakeFirst()
    expect(agentRow).toBeUndefined()

    // User membership should be removed entirely
    const memberRow = await db
      .selectFrom('team_members')
      .selectAll()
      .where('user_id', '=', 'user-1')
      .executeTakeFirst()
    expect(memberRow).toBeUndefined()
  })

  it('skips duplicate user when parent already has that member', async () => {
    const parent = await createTeam({
      name: 'Engineering',
      parent_team_id: null,
      charter: null,
      slug: 'engineering',
    })
    const child = await createTeam({
      name: 'Frontend',
      parent_team_id: parent.id,
      charter: null,
      slug: 'frontend',
    })

    // user-1 is already in parent AND in child
    await db
      .insertInto('team_members')
      .values({ team_id: parent.id, user_id: 'user-1', role: 'lead' })
      .execute()
    await db
      .insertInto('team_members')
      .values({ team_id: child.id, user_id: 'user-1', role: 'member' })
      .execute()
    // user-2 is only in child
    await db
      .insertInto('team_members')
      .values({ team_id: child.id, user_id: 'user-2', role: 'member' })
      .execute()

    await deleteTeamWithReparent(child.id)

    // Child team should be gone
    expect(await findTeamById(child.id)).toBeNull()

    // user-1 should still be in parent with their original role (lead), not duplicated
    const user1Rows = await db
      .selectFrom('team_members')
      .selectAll()
      .where('user_id', '=', 'user-1')
      .execute()
    expect(user1Rows).toHaveLength(1)
    expect(user1Rows[0]?.team_id).toBe(parent.id)
    expect(user1Rows[0]?.role).toBe('lead')

    // user-2 should have been moved to parent
    const user2Row = await db
      .selectFrom('team_members')
      .selectAll()
      .where('user_id', '=', 'user-2')
      .executeTakeFirst()
    expect(user2Row?.team_id).toBe(parent.id)
  })

  it('rolls back entire transaction if delete fails mid-way', async () => {
    const parent = await createTeam({
      name: 'Engineering',
      parent_team_id: null,
      charter: null,
      slug: 'engineering',
    })
    const child = await createTeam({
      name: 'Frontend',
      parent_team_id: parent.id,
      charter: null,
      slug: 'frontend',
    })
    const grandchild = await createTeam({
      name: 'Components',
      parent_team_id: child.id,
      charter: null,
      slug: 'components',
    })

    await addAgentToTeam({ agent_id: 'agent-1', team_id: child.id, is_primary: 1 })

    // Run a transaction that will fail after reparenting + agent move but before
    // the final delete, simulating a constraint violation or internal error.
    const error = await (async () => {
      try {
        await db.transaction().execute(async (trx) => {
          // Reparent children (same as production code)
          await trx
            .updateTable('teams')
            .set({ parent_team_id: parent.id })
            .where('parent_team_id', '=', child.id)
            .execute()

          // Move agent to parent (same as production code)
          await trx
            .updateTable('agent_teams')
            .set({ team_id: parent.id })
            .where('team_id', '=', child.id)
            .execute()

          // Simulate a failure before the team row is deleted
          throw new Error('Simulated failure')
        })
      } catch (e) {
        return e
      }
    })()

    expect((error as Error).message).toBe('Simulated failure')

    // Everything should be rolled back:
    // grandchild should still point at child
    const gc = await findTeamById(grandchild.id)
    expect(gc?.parent_team_id).toBe(child.id)

    // Agent should still be on child team, not parent
    const agentRow = await db
      .selectFrom('agent_teams')
      .selectAll()
      .where('agent_id', '=', 'agent-1')
      .executeTakeFirst()
    expect(agentRow?.team_id).toBe(child.id)

    // Child team should still exist
    expect(await findTeamById(child.id)).not.toBeNull()
  })
})
