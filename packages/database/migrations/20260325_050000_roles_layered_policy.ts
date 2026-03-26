import { type Kysely } from 'kysely'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

const PLATFORM_ADMIN_ROLE_ID = 'role_platform_admin'
const PLATFORM_SUPERUSER_BUNDLE_ID = 'bundle_platform_superuser'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('roles')
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

  await db.schema
    .createTable('policy_bundles')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('slug', 'text', (col) => col.notNull().unique())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('active', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('is_system', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('is_platform_default', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('role_policy_bundles')
    .addColumn('role_id', 'text', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addColumn('bundle_id', 'text', (col) =>
      col.notNull().references('policy_bundles.id').onDelete('cascade')
    )
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('role_policy_bundles_pk', ['role_id', 'bundle_id'])
    .execute()

  await db.schema
    .createTable('policy_grants')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('bundle_id', 'text', (col) =>
      col.notNull().references('policy_bundles.id').onDelete('cascade')
    )
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('resource_type', 'text')
    .addColumn('resource_id', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('policy_defaults')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('bundle_id', 'text', (col) =>
      col.notNull().references('policy_bundles.id').onDelete('cascade')
    )
    .addColumn('key', 'text', (col) => col.notNull())
    .addColumn('value_json', 'text', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('agent_role_assignments')
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('role_id', 'text', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('agent_role_assignments_pk', ['agent_id', 'role_id'])
    .execute()

  await db.schema
    .createTable('team_role_defaults')
    .addColumn('team_id', 'text', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('role_id', 'text', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('team_role_defaults_pk', ['team_id', 'role_id'])
    .execute()

  await db.schema
    .createTable('agent_policy_bundle_assignments')
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('bundle_id', 'text', (col) =>
      col.notNull().references('policy_bundles.id').onDelete('cascade')
    )
    .addColumn('assignment_kind', 'text', (col) => col.notNull().defaultTo('override'))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('agent_policy_bundle_assignments_pk', ['agent_id', 'bundle_id'])
    .execute()

  await db.schema
    .createIndex('idx_policy_grants_bundle_action')
    .on('policy_grants')
    .columns(['bundle_id', 'action'])
    .execute()

  await db.schema
    .createIndex('idx_policy_defaults_bundle_key')
    .on('policy_defaults')
    .columns(['bundle_id', 'key'])
    .execute()

  await db.schema
    .createIndex('idx_agent_role_assignments_role')
    .on('agent_role_assignments')
    .column('role_id')
    .execute()

  await db.schema
    .createIndex('idx_team_role_defaults_role')
    .on('team_role_defaults')
    .column('role_id')
    .execute()

  await db.schema
    .createIndex('idx_agent_policy_bundle_assignments_kind')
    .on('agent_policy_bundle_assignments')
    .columns(['agent_id', 'assignment_kind'])
    .execute()

  const timestamp = now()

  await db
    .insertInto('policy_bundles')
    .values({
      id: PLATFORM_SUPERUSER_BUNDLE_ID,
      slug: 'platform.superuser',
      name: 'Platform Superuser',
      description:
        'Full platform authority across work, company, fleet, policy, routines, and sandboxes.',
      active: 1,
      is_system: 1,
      is_platform_default: 0,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute()

  const superuserActions = [
    'policy.read',
    'policy.write',
    'policy.create',
    'policy.delete',
    'work.goal.read',
    'work.goal.write',
    'work.goal.create',
    'work.goal.delete',
    'work.goal.assign_owner',
    'work.goal.assign_team',
    'work.goal.staff',
    'work.goal.reorder',
    'work.ticket.read',
    'work.ticket.write',
    'work.ticket.create',
    'work.ticket.delete',
    'work.ticket.link',
    'work.ticket.reorder',
    'company.team.read',
    'company.team.write',
    'company.team.create',
    'company.team.delete',
    'company.team.staff',
    'company.team.restructure',
    'fleet.agent.read',
    'fleet.agent.write',
    'fleet.agent.create',
    'fleet.agent.delete',
    'fleet.agent.control',
    'routine.manage',
    'sandbox.ephemeral.create',
  ]

  for (const action of superuserActions) {
    await db
      .insertInto('policy_grants')
      .values({
        id: crypto.randomUUID(),
        bundle_id: PLATFORM_SUPERUSER_BUNDLE_ID,
        action,
        resource_type: '*',
        resource_id: null,
        created_at: timestamp,
      })
      .execute()
  }

  await db
    .insertInto('roles')
    .values({
      id: PLATFORM_ADMIN_ROLE_ID,
      slug: 'platform_admin',
      name: 'Platform Admin',
      charter:
        'Owns platform-wide operational control, fleet configuration, and org restructuring.',
      job_description:
        'A senior operator with broad authority over teams, goals, policies, and agent configuration.',
      escalation_posture:
        'Act decisively for platform safety and unblock operations; audit every sensitive change.',
      active: 1,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute()

  await db
    .insertInto('role_policy_bundles')
    .values({
      role_id: PLATFORM_ADMIN_ROLE_ID,
      bundle_id: PLATFORM_SUPERUSER_BUNDLE_ID,
      created_at: timestamp,
    })
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_agent_policy_bundle_assignments_kind').ifExists().execute()
  await db.schema.dropIndex('idx_team_role_defaults_role').ifExists().execute()
  await db.schema.dropIndex('idx_agent_role_assignments_role').ifExists().execute()
  await db.schema.dropIndex('idx_policy_defaults_bundle_key').ifExists().execute()
  await db.schema.dropIndex('idx_policy_grants_bundle_action').ifExists().execute()

  await db.schema.dropTable('agent_policy_bundle_assignments').ifExists().execute()
  await db.schema.dropTable('team_role_defaults').ifExists().execute()
  await db.schema.dropTable('agent_role_assignments').ifExists().execute()
  await db.schema.dropTable('policy_defaults').ifExists().execute()
  await db.schema.dropTable('policy_grants').ifExists().execute()
  await db.schema.dropTable('role_policy_bundles').ifExists().execute()
  await db.schema.dropTable('policy_bundles').ifExists().execute()
  await db.schema.dropTable('roles').ifExists().execute()
}
