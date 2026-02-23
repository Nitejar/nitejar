import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('agent_memories')
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .execute()
}
