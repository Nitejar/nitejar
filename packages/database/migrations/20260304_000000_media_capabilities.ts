import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('media_artifacts')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('job_id', 'text', (col) => col.notNull().references('jobs.id').onDelete('cascade'))
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('artifact_type', 'text', (col) => col.notNull())
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('model', 'text', (col) => col.notNull())
    .addColumn('operation', 'text', (col) => col.notNull())
    .addColumn('file_path', 'text')
    .addColumn('file_size_bytes', 'integer')
    .addColumn('metadata', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('cost_usd', 'real')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_media_artifacts_job_created')
    .ifNotExists()
    .on('media_artifacts')
    .columns(['job_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_media_artifacts_agent_created')
    .ifNotExists()
    .on('media_artifacts')
    .columns(['agent_id', 'created_at'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_media_artifacts_agent_created').ifExists().execute()
  await db.schema.dropIndex('idx_media_artifacts_job_created').ifExists().execute()
  await db.schema.dropTable('media_artifacts').ifExists().execute()
}
