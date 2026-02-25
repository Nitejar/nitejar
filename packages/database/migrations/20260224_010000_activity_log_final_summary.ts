import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<Record<string, unknown>>): Promise<void> {
  await sql.raw('ALTER TABLE activity_log ADD COLUMN final_summary TEXT').execute(db)
}

export async function down(db: Kysely<Record<string, unknown>>): Promise<void> {
  await db.schema.alterTable('activity_log').dropColumn('final_summary').execute()
}
