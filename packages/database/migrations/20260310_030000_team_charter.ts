import { type Kysely } from 'kysely'

/**
 * Rename teams.description → teams.charter.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('teams').renameColumn('description', 'charter').execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('teams').renameColumn('charter', 'description').execute()
}
