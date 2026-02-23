import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('avatar_url', 'text')
    .addColumn('role', 'text', (col) => col.notNull().defaultTo('member'))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('invited'))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('invitations')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('token', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('expires_at', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('teams')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('slug', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('team_members')
    .ifNotExists()
    .addColumn('team_id', 'text', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('user_id', 'text', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('role', 'text', (col) => col.notNull().defaultTo('member'))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addPrimaryKeyConstraint('team_members_pk', ['team_id', 'user_id'])
    .execute()

  await db.schema
    .createTable('agent_teams')
    .ifNotExists()
    .addColumn('team_id', 'text', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('is_primary', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addPrimaryKeyConstraint('agent_teams_pk', ['team_id', 'agent_id'])
    .execute()

  await db.schema
    .createIndex('idx_team_members_user')
    .ifNotExists()
    .on('team_members')
    .column('user_id')
    .execute()

  await db.schema
    .createIndex('idx_team_members_team')
    .ifNotExists()
    .on('team_members')
    .column('team_id')
    .execute()

  await db.schema
    .createIndex('idx_agent_teams_agent')
    .ifNotExists()
    .on('agent_teams')
    .column('agent_id')
    .execute()

  await db.schema
    .createIndex('idx_agent_teams_team')
    .ifNotExists()
    .on('agent_teams')
    .column('team_id')
    .execute()
}
