import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  const typedDb = db as Kysely<any>

  await typedDb.schema
    .alterTable('app_sessions')
    .addColumn('forked_from_session_key', 'text')
    .execute()

  await typedDb.schema
    .createIndex('idx_app_sessions_forked_from')
    .ifNotExists()
    .on('app_sessions')
    .column('forked_from_session_key')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const typedDb = db as Kysely<any>
  await typedDb.schema.dropIndex('idx_app_sessions_forked_from').ifExists().execute()
  await typedDb.schema.alterTable('app_sessions').dropColumn('forked_from_session_key').execute()
}
