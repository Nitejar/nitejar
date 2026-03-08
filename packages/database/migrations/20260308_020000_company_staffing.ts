import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('goals')
    .addColumn('team_id', 'text', (col) => col.references('teams.id').onDelete('set null'))
    .execute()

  await db.schema
    .createIndex('idx_goals_team_status_updated_at')
    .ifNotExists()
    .on('goals')
    .columns(['team_id', 'status', 'updated_at'])
    .execute()

  await db.schema
    .createTable('goal_agent_allocations')
    .ifNotExists()
    .addColumn('goal_id', 'text', (col) => col.notNull().references('goals.id').onDelete('cascade'))
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('created_by_kind', 'text', (col) => col.notNull())
    .addColumn('created_by_ref', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addPrimaryKeyConstraint('goal_agent_allocations_pk', ['goal_id', 'agent_id'])
    .execute()

  await db.schema
    .createIndex('idx_goal_agent_allocations_agent')
    .ifNotExists()
    .on('goal_agent_allocations')
    .columns(['agent_id', 'created_at'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_goal_agent_allocations_agent').ifExists().execute()
  await db.schema.dropTable('goal_agent_allocations').ifExists().execute()
  await db.schema.dropIndex('idx_goals_team_status_updated_at').ifExists().execute()
  await db.schema.alterTable('goals').dropColumn('team_id').execute()
}
