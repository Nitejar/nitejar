import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('inference_calls')
    .addColumn('cache_read_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()

  await db.schema
    .alterTable('inference_calls')
    .addColumn('cache_write_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()
}
