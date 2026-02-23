import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('audit_logs')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('event_type', 'text', (col) => col.notNull())
    .addColumn('agent_id', 'text')
    .addColumn('github_repo_id', 'integer')
    .addColumn('capability', 'text')
    .addColumn('result', 'text')
    .addColumn('metadata', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_audit_logs_event_type')
    .ifNotExists()
    .on('audit_logs')
    .column('event_type')
    .execute()

  await db.schema
    .createIndex('idx_audit_logs_agent')
    .ifNotExists()
    .on('audit_logs')
    .column('agent_id')
    .execute()

  await db.schema
    .createIndex('idx_audit_logs_repo')
    .ifNotExists()
    .on('audit_logs')
    .column('github_repo_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_audit_logs_repo').ifExists().execute()

  await db.schema.dropIndex('idx_audit_logs_agent').ifExists().execute()

  await db.schema.dropIndex('idx_audit_logs_event_type').ifExists().execute()

  await db.schema.dropTable('audit_logs').ifExists().execute()
}
