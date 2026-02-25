import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<Record<string, unknown>>): Promise<void> {
  await sql
    .raw("ALTER TABLE agent_memories ADD COLUMN memory_kind TEXT NOT NULL DEFAULT 'fact'")
    .execute(db)
}

export async function down(db: Kysely<Record<string, unknown>>): Promise<void> {
  await db.schema.alterTable('agent_memories').dropColumn('memory_kind').execute()
}
