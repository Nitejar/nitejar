import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('app_sessions')
    .ifNotExists()
    .addColumn('session_key', 'text', (col) => col.primaryKey())
    .addColumn('owner_user_id', 'text', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('primary_agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('title', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('last_activity_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('app_session_participants')
    .ifNotExists()
    .addColumn('session_key', 'text', (col) =>
      col.notNull().references('app_sessions.session_key').onDelete('cascade')
    )
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('added_by_user_id', 'text', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('added_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addPrimaryKeyConstraint('app_session_participants_pk', ['session_key', 'agent_id'])
    .execute()

  await db.schema
    .createIndex('idx_app_sessions_owner_last_activity')
    .ifNotExists()
    .on('app_sessions')
    .columns(['owner_user_id', 'last_activity_at'])
    .execute()

  await db.schema
    .createIndex('idx_app_session_participants_agent_session')
    .ifNotExists()
    .on('app_session_participants')
    .columns(['agent_id', 'session_key'])
    .execute()

  await db.schema
    .createIndex('idx_work_items_session_key_created_at')
    .ifNotExists()
    .on('work_items')
    .columns(['session_key', 'created_at'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_work_items_session_key_created_at').ifExists().execute()
  await db.schema.dropIndex('idx_app_session_participants_agent_session').ifExists().execute()
  await db.schema.dropIndex('idx_app_sessions_owner_last_activity').ifExists().execute()
  await db.schema.dropTable('app_session_participants').ifExists().execute()
  await db.schema.dropTable('app_sessions').ifExists().execute()
}
