import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('plugin_artifacts')
    .ifNotExists()
    .addColumn('plugin_id', 'text', (col) => col.notNull())
    .addColumn('version', 'text', (col) => col.notNull())
    .addColumn('tgz_blob', 'blob', (col) => col.notNull())
    .addColumn('size_bytes', 'integer', (col) => col.notNull())
    .addColumn('checksum', 'text', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(sql`(unixepoch())`))
    .addPrimaryKeyConstraint('pk_plugin_artifacts', ['plugin_id', 'version'])
    .addForeignKeyConstraint('fk_plugin_artifacts_plugin', ['plugin_id'], 'plugins', ['id'], (cb) =>
      cb.onDelete('cascade')
    )
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('plugin_artifacts').ifExists().execute()
}
