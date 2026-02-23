import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('plugins')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('enabled', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('trust_level', 'text', (col) => col.notNull().defaultTo('unknown'))
    .addColumn('source_kind', 'text', (col) => col.notNull())
    .addColumn('source_ref', 'text')
    .addColumn('current_version', 'text')
    .addColumn('current_checksum', 'text')
    .addColumn('current_install_path', 'text')
    .addColumn('manifest_json', 'text', (col) => col.notNull())
    .addColumn('config_json', 'text')
    .addColumn('last_load_error', 'text')
    .addColumn('last_loaded_at', 'integer')
    .addColumn('installed_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('plugin_versions')
    .ifNotExists()
    .addColumn('plugin_id', 'text', (col) =>
      col.notNull().references('plugins.id').onDelete('cascade')
    )
    .addColumn('version', 'text', (col) => col.notNull())
    .addColumn('checksum', 'text', (col) => col.notNull())
    .addColumn('install_path', 'text', (col) => col.notNull())
    .addColumn('manifest_json', 'text', (col) => col.notNull())
    .addColumn('signature_json', 'text')
    .addColumn('installed_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addPrimaryKeyConstraint('plugin_versions_pk', ['plugin_id', 'version'])
    .execute()

  await db.schema
    .createTable('plugin_permission_grants')
    .ifNotExists()
    .addColumn('plugin_id', 'text', (col) =>
      col.notNull().references('plugins.id').onDelete('cascade')
    )
    .addColumn('permission', 'text', (col) => col.notNull())
    .addColumn('scope', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('granted', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('granted_at', 'integer')
    .addPrimaryKeyConstraint('plugin_permission_grants_pk', ['plugin_id', 'permission', 'scope'])
    .execute()

  await db.schema
    .createTable('plugin_events')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('plugin_id', 'text', (col) =>
      col.notNull().references('plugins.id').onDelete('cascade')
    )
    .addColumn('plugin_version', 'text')
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('work_item_id', 'text')
    .addColumn('job_id', 'text')
    .addColumn('hook_name', 'text')
    .addColumn('duration_ms', 'integer')
    .addColumn('detail_json', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_plugin_versions_plugin')
    .ifNotExists()
    .on('plugin_versions')
    .column('plugin_id')
    .execute()

  await db.schema
    .createIndex('idx_plugin_permission_grants_plugin')
    .ifNotExists()
    .on('plugin_permission_grants')
    .columns(['plugin_id', 'granted'])
    .execute()

  await db.schema
    .createIndex('idx_plugin_events_plugin_time')
    .ifNotExists()
    .on('plugin_events')
    .columns(['plugin_id', 'created_at'])
    .execute()
}
