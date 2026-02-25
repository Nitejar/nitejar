import type { Kysely } from 'kysely'

export async function up(db: Kysely<Record<string, unknown>>): Promise<void> {
  await db.schema.alterTable('agent_plugin_instances').addColumn('policy_json', 'text').execute()
}

export async function down(db: Kysely<Record<string, unknown>>): Promise<void> {
  await db.schema.alterTable('agent_plugin_instances').dropColumn('policy_json').execute()
}
