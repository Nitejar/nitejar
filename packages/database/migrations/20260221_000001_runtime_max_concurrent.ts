import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<Record<string, unknown>>): Promise<void> {
  await db.schema
    .alterTable('runtime_control')
    .addColumn('max_concurrent_dispatches', 'integer', (col) => col.notNull().defaultTo(20))
    .execute()

  await sql`UPDATE runtime_control SET max_concurrent_dispatches = 20 WHERE id = 'default'`.execute(
    db
  )
}

export async function down(db: Kysely<Record<string, unknown>>): Promise<void> {
  await db.schema.alterTable('runtime_control').dropColumn('max_concurrent_dispatches').execute()
}
