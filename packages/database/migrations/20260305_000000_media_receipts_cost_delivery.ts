import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('external_api_calls').addColumn('tool_call_id', 'text').execute()

  await db.schema
    .alterTable('external_api_calls')
    .addColumn('media_artifact_id', 'text', (col) =>
      col.references('media_artifacts.id').onDelete('set null')
    )
    .execute()

  await db.schema
    .alterTable('external_api_calls')
    .addColumn('pricing_status', 'text', (col) => col.notNull().defaultTo('unknown'))
    .execute()

  await db.schema.alterTable('external_api_calls').addColumn('pricing_source', 'text').execute()

  await db.schema
    .createIndex('idx_external_api_calls_job_tool_call')
    .ifNotExists()
    .on('external_api_calls')
    .columns(['job_id', 'tool_call_id'])
    .execute()

  await db.schema
    .createIndex('idx_external_api_calls_provider_operation_created')
    .ifNotExists()
    .on('external_api_calls')
    .columns(['provider', 'operation', 'created_at'])
    .execute()

  await db.schema.alterTable('media_artifacts').addColumn('file_name', 'text').execute()

  await db.schema.alterTable('media_artifacts').addColumn('mime_type', 'text').execute()

  await db.schema.alterTable('media_artifacts').addColumn('transcript_text', 'text').execute()

  await db.schema
    .createTable('media_artifact_blobs')
    .ifNotExists()
    .addColumn('artifact_id', 'text', (col) =>
      col.primaryKey().notNull().references('media_artifacts.id').onDelete('cascade')
    )
    .addColumn('blob_data', isPostgres ? 'bytea' : 'blob', (col) => col.notNull())
    .addColumn('sha256', 'text', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('media_artifact_deliveries')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('media_artifact_id', 'text', (col) =>
      col.notNull().references('media_artifacts.id').onDelete('cascade')
    )
    .addColumn('effect_outbox_id', 'text', (col) =>
      col.notNull().references('effect_outbox.id').onDelete('cascade')
    )
    .addColumn('plugin_instance_id', 'text', (col) =>
      col.notNull().references('plugin_instances.id').onDelete('cascade')
    )
    .addColumn('channel', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('provider_ref', 'text')
    .addColumn('error_text', 'text')
    .addColumn('metadata', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_media_artifact_deliveries_artifact_created')
    .ifNotExists()
    .on('media_artifact_deliveries')
    .columns(['media_artifact_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_media_artifact_deliveries_effect_created')
    .ifNotExists()
    .on('media_artifact_deliveries')
    .columns(['effect_outbox_id', 'created_at'])
    .execute()
}
