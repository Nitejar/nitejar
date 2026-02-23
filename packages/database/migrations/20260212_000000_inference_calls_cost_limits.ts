import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  // inference_calls — one row per model API call (retries/fallbacks get their own row)
  await db.schema
    .createTable('inference_calls')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('job_id', 'text', (col) => col.notNull().references('jobs.id').onDelete('cascade'))
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('turn', 'integer', (col) => col.notNull())
    .addColumn('model', 'text', (col) => col.notNull())
    .addColumn('prompt_tokens', 'integer', (col) => col.notNull())
    .addColumn('completion_tokens', 'integer', (col) => col.notNull())
    .addColumn('total_tokens', 'integer', (col) => col.notNull())
    .addColumn('estimated_cost_usd', 'real')
    .addColumn('tool_call_names', 'text')
    .addColumn('finish_reason', 'text')
    .addColumn('is_fallback', 'integer', (col) => col.defaultTo(0))
    .addColumn('duration_ms', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  // Indexes for common query patterns
  await db.schema
    .createIndex('idx_inference_calls_agent_created')
    .ifNotExists()
    .on('inference_calls')
    .columns(['agent_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_inference_calls_job')
    .ifNotExists()
    .on('inference_calls')
    .column('job_id')
    .execute()

  // cost_limits — per-agent budget caps
  await db.schema
    .createTable('cost_limits')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('period', 'text', (col) => col.notNull())
    .addColumn('limit_usd', 'real', (col) => col.notNull())
    .addColumn('enabled', 'integer', (col) => col.defaultTo(1))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_cost_limits_agent')
    .ifNotExists()
    .on('cost_limits')
    .column('agent_id')
    .execute()
}
