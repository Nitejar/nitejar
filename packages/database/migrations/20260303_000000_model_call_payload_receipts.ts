import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('model_call_payloads')
    .ifNotExists()
    .addColumn('hash', 'text', (col) => col.primaryKey())
    .addColumn('payload_json', 'text', (col) => col.notNull())
    .addColumn('metadata_json', 'text')
    .addColumn('byte_size', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_model_call_payloads_created_at')
    .ifNotExists()
    .on('model_call_payloads')
    .column('created_at')
    .execute()

  await db.schema
    .alterTable('inference_calls')
    .addColumn('request_payload_hash', 'text', (col) => col.references('model_call_payloads.hash'))
    .execute()

  await db.schema
    .alterTable('inference_calls')
    .addColumn('response_payload_hash', 'text', (col) => col.references('model_call_payloads.hash'))
    .execute()

  await db.schema.alterTable('inference_calls').addColumn('attempt_kind', 'text').execute()
  await db.schema.alterTable('inference_calls').addColumn('attempt_index', 'integer').execute()
  await db.schema.alterTable('inference_calls').addColumn('payload_state', 'text').execute()
  await db.schema.alterTable('inference_calls').addColumn('model_span_id', 'text').execute()

  await sql`UPDATE inference_calls
    SET payload_state = 'legacy_unavailable'
    WHERE payload_state IS NULL`.execute(db)
}
