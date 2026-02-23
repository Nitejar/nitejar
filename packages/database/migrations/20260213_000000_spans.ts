import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('spans')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('trace_id', 'text', (col) => col.notNull())
    .addColumn('parent_span_id', 'text')
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('ok'))
    .addColumn('start_time', 'integer', (col) => col.notNull())
    .addColumn('end_time', 'integer')
    .addColumn('duration_ms', 'integer')
    .addColumn('attributes', 'text')
    .addColumn('job_id', 'text', (col) => col.notNull().references('jobs.id').onDelete('cascade'))
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_spans_trace_id')
    .ifNotExists()
    .on('spans')
    .column('trace_id')
    .execute()

  await db.schema
    .createIndex('idx_spans_job_name')
    .ifNotExists()
    .on('spans')
    .columns(['job_id', 'name'])
    .execute()

  await db.schema
    .createIndex('idx_spans_agent_created')
    .ifNotExists()
    .on('spans')
    .columns(['agent_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_spans_parent')
    .ifNotExists()
    .on('spans')
    .column('parent_span_id')
    .execute()
}
