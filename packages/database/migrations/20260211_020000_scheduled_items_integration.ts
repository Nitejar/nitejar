import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE scheduled_items ADD COLUMN plugin_instance_id TEXT REFERENCES plugin_instances(id)`.execute(
    db
  )
  await sql`ALTER TABLE scheduled_items ADD COLUMN response_context TEXT`.execute(db)
}
