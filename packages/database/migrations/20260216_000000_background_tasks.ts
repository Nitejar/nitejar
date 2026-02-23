import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('background_tasks')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('job_id', 'text', (col) => col.notNull().references('jobs.id').onDelete('cascade'))
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('sprite_name', 'text', (col) => col.notNull())
    .addColumn('sprite_session_id', 'text', (col) => col.notNull())
    .addColumn('label', 'text')
    .addColumn('command', 'text', (col) => col.notNull())
    .addColumn('cwd', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('running'))
    .addColumn('cleanup_on_run_end', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('exit_code', 'integer')
    .addColumn('error_text', 'text')
    .addColumn('output_tail', 'text')
    .addColumn('started_at', 'integer', (col) => col.notNull())
    .addColumn('finished_at', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_background_tasks_job_status')
    .ifNotExists()
    .on('background_tasks')
    .columns(['job_id', 'status'])
    .execute()

  await db.schema
    .createIndex('idx_background_tasks_agent_created')
    .ifNotExists()
    .on('background_tasks')
    .columns(['agent_id', 'created_at'])
    .execute()
}
