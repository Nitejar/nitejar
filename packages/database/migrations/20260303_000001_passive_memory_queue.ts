import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('passive_memory_queue')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('job_id', 'text', (col) => col.notNull().references('jobs.id').onDelete('cascade'))
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('work_item_id', 'text', (col) =>
      col.notNull().references('work_items.id').onDelete('cascade')
    )
    .addColumn('dispatch_id', 'text', (col) =>
      col.references('run_dispatches.id').onDelete('set null')
    )
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('attempt_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('max_attempts', 'integer', (col) => col.notNull().defaultTo(3))
    .addColumn('next_attempt_at', 'integer')
    .addColumn('claimed_by', 'text')
    .addColumn('lease_expires_at', 'integer')
    .addColumn('last_error', 'text')
    .addColumn('summary_json', 'text')
    .addColumn('started_at', 'integer')
    .addColumn('completed_at', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addUniqueConstraint('uq_passive_memory_queue_job', ['job_id'])
    .execute()

  await db.schema
    .createIndex('idx_passive_memory_queue_status_next')
    .ifNotExists()
    .on('passive_memory_queue')
    .columns(['status', 'next_attempt_at'])
    .execute()

  await db.schema
    .createIndex('idx_passive_memory_queue_work_item_created')
    .ifNotExists()
    .on('passive_memory_queue')
    .columns(['work_item_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_passive_memory_queue_agent_created')
    .ifNotExists()
    .on('passive_memory_queue')
    .columns(['agent_id', 'created_at'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_passive_memory_queue_agent_created').ifExists().execute()
  await db.schema.dropIndex('idx_passive_memory_queue_work_item_created').ifExists().execute()
  await db.schema.dropIndex('idx_passive_memory_queue_status_next').ifExists().execute()
  await db.schema.dropTable('passive_memory_queue').ifExists().execute()
}
