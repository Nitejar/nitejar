import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('inference_calls').addColumn('cost_usd', 'real').execute()
}
