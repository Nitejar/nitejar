import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('queue_lanes')
    .addColumn('mode', 'text', (col) => col.notNull().defaultTo('steer'))
    .execute()
}
