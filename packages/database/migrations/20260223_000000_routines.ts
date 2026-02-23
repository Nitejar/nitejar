import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('routines')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('enabled', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('trigger_kind', 'text', (col) => col.notNull())
    .addColumn('cron_expr', 'text')
    .addColumn('timezone', 'text')
    .addColumn('rule_json', 'text', (col) => col.notNull())
    .addColumn('condition_probe', 'text')
    .addColumn('condition_config', 'text')
    .addColumn('target_plugin_instance_id', 'text', (col) =>
      col.notNull().references('plugin_instances.id').onDelete('cascade')
    )
    .addColumn('target_session_key', 'text', (col) => col.notNull())
    .addColumn('target_response_context', 'text')
    .addColumn('action_prompt', 'text', (col) => col.notNull())
    .addColumn('next_run_at', 'integer')
    .addColumn('last_evaluated_at', 'integer')
    .addColumn('last_fired_at', 'integer')
    .addColumn('last_status', 'text')
    .addColumn('created_by_kind', 'text', (col) => col.notNull())
    .addColumn('created_by_ref', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('archived_at', 'integer')
    .execute()

  await db.schema
    .createTable('routine_runs')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('routine_id', 'text', (col) =>
      col.notNull().references('routines.id').onDelete('cascade')
    )
    .addColumn('trigger_origin', 'text', (col) => col.notNull())
    .addColumn('trigger_ref', 'text')
    .addColumn('envelope_json', 'text')
    .addColumn('decision', 'text', (col) => col.notNull())
    .addColumn('decision_reason', 'text')
    .addColumn('scheduled_item_id', 'text')
    .addColumn('work_item_id', 'text')
    .addColumn('evaluated_at', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('routine_event_queue')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('event_key', 'text', (col) => col.notNull().unique())
    .addColumn('envelope_json', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('attempt_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_error', 'text')
    .addColumn('lease_expires_at', 'integer')
    .addColumn('claimed_by', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await sql`ALTER TABLE scheduled_items ADD COLUMN routine_id TEXT REFERENCES routines(id)`.execute(
    db
  )
  await sql`ALTER TABLE scheduled_items ADD COLUMN routine_run_id TEXT REFERENCES routine_runs(id)`.execute(
    db
  )

  await db.schema
    .createIndex('idx_routines_enabled_next_run_at')
    .ifNotExists()
    .on('routines')
    .columns(['enabled', 'next_run_at'])
    .execute()

  await db.schema
    .createIndex('idx_routines_agent_enabled')
    .ifNotExists()
    .on('routines')
    .columns(['agent_id', 'enabled'])
    .execute()

  await sql`CREATE INDEX IF NOT EXISTS idx_routine_runs_routine_eval_desc ON routine_runs (routine_id, evaluated_at DESC)`.execute(
    db
  )

  await db.schema
    .createIndex('idx_routine_runs_work_item')
    .ifNotExists()
    .on('routine_runs')
    .column('work_item_id')
    .execute()

  await db.schema
    .createIndex('idx_routine_event_queue_status_created_id')
    .ifNotExists()
    .on('routine_event_queue')
    .columns(['status', 'created_at', 'id'])
    .execute()
}
