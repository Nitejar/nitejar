import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

async function recreateRoutinesTableForSqlite(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys=OFF`.execute(db)

  await db.schema
    .createTable('routines__next')
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
      col.references('plugin_instances.id').onDelete('cascade')
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
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addColumn('archived_at', 'integer')
    .execute()

  await sql`
    INSERT INTO routines__next (
      id,
      agent_id,
      name,
      description,
      enabled,
      trigger_kind,
      cron_expr,
      timezone,
      rule_json,
      condition_probe,
      condition_config,
      target_plugin_instance_id,
      target_session_key,
      target_response_context,
      action_prompt,
      next_run_at,
      last_evaluated_at,
      last_fired_at,
      last_status,
      created_by_kind,
      created_by_ref,
      created_at,
      updated_at,
      archived_at
    )
    SELECT
      id,
      agent_id,
      name,
      description,
      enabled,
      trigger_kind,
      cron_expr,
      timezone,
      rule_json,
      condition_probe,
      condition_config,
      target_plugin_instance_id,
      target_session_key,
      target_response_context,
      action_prompt,
      next_run_at,
      last_evaluated_at,
      last_fired_at,
      last_status,
      created_by_kind,
      created_by_ref,
      created_at,
      updated_at,
      archived_at
    FROM routines
  `.execute(db)

  await db.schema.dropTable('routines').execute()
  await sql`ALTER TABLE routines__next RENAME TO routines`.execute(db)

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

  await sql`PRAGMA foreign_keys=ON`.execute(db)
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE work_updates ADD COLUMN team_id TEXT REFERENCES teams(id)`.execute(db)
  await db.schema
    .createIndex('idx_work_updates_team_created_at')
    .ifNotExists()
    .on('work_updates')
    .columns(['team_id', 'created_at'])
    .execute()

  if (isPostgres) {
    await sql`ALTER TABLE routines ALTER COLUMN target_plugin_instance_id DROP NOT NULL`.execute(db)
    return
  }

  await recreateRoutinesTableForSqlite(db)
}
