import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  // capability_settings — stores API keys for optional capabilities (web search, etc.)
  await db.schema
    .createTable('capability_settings')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('api_key_encrypted', 'text')
    .addColumn('enabled', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('config', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  // external_api_calls — tracks costs for non-inference API usage (Tavily, etc.)
  await db.schema
    .createTable('external_api_calls')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('job_id', 'text', (col) => col.notNull().references('jobs.id').onDelete('cascade'))
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('operation', 'text', (col) => col.notNull())
    .addColumn('cost_usd', 'real')
    .addColumn('credits_used', 'integer')
    .addColumn('duration_ms', 'integer')
    .addColumn('metadata', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_external_api_calls_agent_created')
    .ifNotExists()
    .on('external_api_calls')
    .columns(['agent_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_external_api_calls_job')
    .ifNotExists()
    .on('external_api_calls')
    .column('job_id')
    .execute()
}
