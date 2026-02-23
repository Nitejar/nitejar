import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('scheduled_items')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('session_key', 'text', (col) => col.notNull())
    .addColumn('type', 'text', (col) => col.notNull().defaultTo('deferred'))
    .addColumn('payload', 'text', (col) => col.notNull())
    .addColumn('run_at', 'integer', (col) => col.notNull())
    .addColumn('recurrence', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('source_ref', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('fired_at', 'integer')
    .addColumn('cancelled_at', 'integer')
    .execute()

  // Partial index for the ticker query: only pending items ordered by run_at
  // Kysely doesn't support WHERE on indexes, so use raw SQL
  await sql`CREATE INDEX IF NOT EXISTS idx_scheduled_items_pending ON scheduled_items (status, run_at) WHERE status = 'pending'`.execute(
    db
  )

  await db.schema
    .createIndex('idx_scheduled_items_agent')
    .ifNotExists()
    .on('scheduled_items')
    .column('agent_id')
    .execute()

  await db.schema
    .createIndex('idx_scheduled_items_session_key')
    .ifNotExists()
    .on('scheduled_items')
    .column('session_key')
    .execute()
}
