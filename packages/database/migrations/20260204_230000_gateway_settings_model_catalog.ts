import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('gateway_settings')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('provider', 'text', (col) => col.notNull().defaultTo('openrouter'))
    .addColumn('api_key_encrypted', 'text')
    .addColumn('base_url', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('model_catalog')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('external_id', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('metadata_json', 'text')
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('is_curated', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('refreshed_at', 'integer')
    .execute()

  await db.schema
    .createIndex('idx_gateway_settings_provider')
    .ifNotExists()
    .on('gateway_settings')
    .column('provider')
    .execute()

  await db.schema
    .createIndex('idx_model_catalog_external_id')
    .ifNotExists()
    .on('model_catalog')
    .column('external_id')
    .unique()
    .execute()

  await db.schema
    .createIndex('idx_model_catalog_source')
    .ifNotExists()
    .on('model_catalog')
    .column('source')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_model_catalog_source').ifExists().execute()

  await db.schema.dropIndex('idx_model_catalog_external_id').ifExists().execute()

  await db.schema.dropIndex('idx_gateway_settings_provider').ifExists().execute()

  await db.schema.dropTable('model_catalog').ifExists().execute()

  await db.schema.dropTable('gateway_settings').ifExists().execute()
}
