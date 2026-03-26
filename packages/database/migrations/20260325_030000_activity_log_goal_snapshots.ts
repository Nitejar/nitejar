import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<Record<string, unknown>>): Promise<void> {
  await sql.raw('ALTER TABLE activity_log ADD COLUMN goal_id TEXT').execute(db)
  await sql.raw('ALTER TABLE activity_log ADD COLUMN goal_snapshot_json TEXT').execute(db)
  await sql
    .raw(
      'CREATE INDEX IF NOT EXISTS idx_activity_log_goal_created ON activity_log (goal_id, created_at)'
    )
    .execute(db)
}

export async function down(db: Kysely<Record<string, unknown>>): Promise<void> {
  await sql.raw('DROP INDEX IF EXISTS idx_activity_log_goal_created').execute(db)
  await db.schema.alterTable('activity_log').dropColumn('goal_snapshot_json').execute()
  await db.schema.alterTable('activity_log').dropColumn('goal_id').execute()
}
