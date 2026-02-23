import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // Drop old table and recreate with new name/columns
  await db.schema.dropTable('plugin_permission_grants').ifExists().execute()

  await db.schema
    .createTable('plugin_disclosure_acks')
    .addColumn('plugin_id', 'text', (col) =>
      col.notNull().references('plugins.id').onDelete('cascade')
    )
    .addColumn('permission', 'text', (col) => col.notNull())
    .addColumn('scope', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('acknowledged', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('acknowledged_at', 'integer')
    .addPrimaryKeyConstraint('plugin_disclosure_acks_pk', ['plugin_id', 'permission', 'scope'])
    .execute()

  await db.schema
    .createIndex('idx_plugin_disclosure_acks_plugin_ack')
    .on('plugin_disclosure_acks')
    .columns(['plugin_id', 'acknowledged'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_plugin_disclosure_acks_plugin_ack').ifExists().execute()
  await db.schema.dropTable('plugin_disclosure_acks').ifExists().execute()

  await db.schema
    .createTable('plugin_permission_grants')
    .addColumn('plugin_id', 'text', (col) =>
      col.notNull().references('plugins.id').onDelete('cascade')
    )
    .addColumn('permission', 'text', (col) => col.notNull())
    .addColumn('scope', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('granted', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('granted_at', 'integer')
    .addPrimaryKeyConstraint('plugin_permission_grants_pk', ['plugin_id', 'permission', 'scope'])
    .execute()
}
