import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('jobs').addColumn('final_response', 'text').execute()
}
