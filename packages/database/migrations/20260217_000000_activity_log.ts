import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  const defaultTimestamp = sql`(strftime('%s', 'now'))`

  await db.schema
    .createTable('activity_log')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('agent_handle', 'text', (col) => col.notNull())
    .addColumn('job_id', 'text')
    .addColumn('session_key', 'text')
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('summary', 'text', (col) => col.notNull())
    .addColumn('resources', 'text')
    .addColumn('embedding', 'blob')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_activity_log_status_created')
    .ifNotExists()
    .on('activity_log')
    .columns(['status', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_activity_log_agent_created')
    .ifNotExists()
    .on('activity_log')
    .columns(['agent_id', 'created_at'])
    .execute()
}
