import type { Kysely } from 'kysely'

export async function up(db: Kysely<Record<string, unknown>>): Promise<void> {
  await db.schema.alterTable('runtime_control').addColumn('app_base_url', 'text').execute()
}

export async function down(db: Kysely<Record<string, unknown>>): Promise<void> {
  await db.schema.alterTable('runtime_control').dropColumn('app_base_url').execute()
}
