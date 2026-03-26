import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '../db'
import {
  assignDefaultRoleToTeam,
  assignRoleToAgent,
  createRole,
  deleteRole,
  findRoleById,
  listAgentRoleAssignments,
  listRoleDefaults,
  listRoleGrants,
  listTeamRoleDefaults,
  replaceRoleDefaults,
  replaceRoleGrants,
} from './policy'

let testDir = ''
let db: ReturnType<typeof getDb>

async function createTestSchema(database: ReturnType<typeof getDb>): Promise<void> {
  await database.schema
    .createTable('roles')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('slug', 'text', (col) => col.notNull().unique())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('charter', 'text')
    .addColumn('job_description', 'text')
    .addColumn('escalation_posture', 'text')
    .addColumn('active', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('agents')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('handle', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('sprite_id', 'text')
    .addColumn('config', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('idle'))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
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
    .createTable('role_grants')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('role_id', 'text', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('resource_type', 'text')
    .addColumn('resource_id', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('role_defaults')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('role_id', 'text', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addColumn('key', 'text', (col) => col.notNull())
    .addColumn('value_json', 'text', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('agent_role_assignments')
    .ifNotExists()
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('role_id', 'text', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('agent_role_assignments_pk', ['agent_id', 'role_id'])
    .execute()

  await database.schema
    .createTable('team_role_defaults')
    .ifNotExists()
    .addColumn('team_id', 'text', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('role_id', 'text', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('team_role_defaults_pk', ['team_id', 'role_id'])
    .execute()
}

async function clearTables(): Promise<void> {
  await db.deleteFrom('team_role_defaults').execute()
  await db.deleteFrom('agent_role_assignments').execute()
  await db.deleteFrom('role_defaults').execute()
  await db.deleteFrom('role_grants').execute()
  await db.deleteFrom('teams').execute()
  await db.deleteFrom('agents').execute()
  await db.deleteFrom('roles').execute()
}

async function seedBaseRows(): Promise<void> {
  await db
    .insertInto('agents')
    .values({
      id: 'agent-1',
      handle: 'agent-one',
      name: 'Agent One',
      sprite_id: null,
      config: null,
      status: 'idle',
      created_at: 1,
      updated_at: 1,
    })
    .execute()

  await db
    .insertInto('teams')
    .values({
      id: 'team-1',
      parent_team_id: null,
      name: 'Ops',
      charter: null,
      slug: 'ops',
      sort_order: 0,
      lead_kind: null,
      lead_ref: null,
      created_at: 1,
      updated_at: 1,
    })
    .execute()
}

describe('policy repository', () => {
  const originalDbUrl = process.env.DATABASE_URL

  beforeAll(async () => {
    await closeDb()
    testDir = mkdtempSync(join(tmpdir(), 'nitejar-policy-'))
    process.env.DATABASE_URL = join(testDir, 'test.sqlite')
    db = getDb()
    await createTestSchema(db)
  })

  afterAll(async () => {
    await closeDb()
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl
    else delete process.env.DATABASE_URL
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await clearTables()
    await seedBaseRows()
  })

  it('deletes a role and cascades its grants, defaults, and assignments', async () => {
    const role = await createRole({
      slug: 'chief-of-staff',
      name: 'Chief of Staff',
      charter: 'Keep the machine moving.',
      job_description: null,
      escalation_posture: null,
      active: 1,
    })

    await replaceRoleGrants(role.id, [
      { action: 'policy.read', resource_type: '*', resource_id: null },
    ])
    await replaceRoleDefaults(role.id, [{ key: 'queue.mode', value_json: JSON.stringify('steer') }])
    await assignRoleToAgent('agent-1', role.id)
    await assignDefaultRoleToTeam('team-1', role.id)

    expect(await listRoleGrants(role.id)).toHaveLength(1)
    expect(await listRoleDefaults(role.id)).toHaveLength(1)
    expect(await listAgentRoleAssignments('agent-1')).toHaveLength(1)
    expect(await listTeamRoleDefaults('team-1')).toHaveLength(1)

    await expect(deleteRole(role.id)).resolves.toBe(true)

    expect(await findRoleById(role.id)).toBeNull()
    expect(await listRoleGrants(role.id)).toHaveLength(0)
    expect(await listRoleDefaults(role.id)).toHaveLength(0)
    expect(await listAgentRoleAssignments('agent-1')).toHaveLength(0)
    expect(await listTeamRoleDefaults('team-1')).toHaveLength(0)
  })

  it('returns false when deleting a missing role', async () => {
    await expect(deleteRole('missing-role')).resolves.toBe(false)
  })
})
