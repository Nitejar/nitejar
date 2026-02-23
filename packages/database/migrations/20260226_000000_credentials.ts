import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('credentials')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('alias', 'text', (col) => col.notNull().unique())
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('auth_type', 'text', (col) => col.notNull().defaultTo('api_key'))
    .addColumn('secret_encrypted', 'text', (col) => col.notNull())
    .addColumn('auth_location', 'text', (col) => col.notNull())
    .addColumn('auth_key', 'text', (col) => col.notNull())
    .addColumn('auth_scheme', 'text')
    .addColumn('allowed_hosts', 'text', (col) => col.notNull())
    .addColumn('enabled', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('allow_manual_auth_headers', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_credentials_provider_enabled')
    .ifNotExists()
    .on('credentials')
    .columns(['provider', 'enabled'])
    .execute()

  await db.schema
    .createTable('agent_credentials')
    .ifNotExists()
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('credential_id', 'text', (col) =>
      col.notNull().references('credentials.id').onDelete('cascade')
    )
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addPrimaryKeyConstraint('agent_credentials_pk', ['agent_id', 'credential_id'])
    .execute()

  await db.schema
    .createIndex('idx_agent_credentials_credential')
    .ifNotExists()
    .on('agent_credentials')
    .column('credential_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_agent_credentials_credential').ifExists().execute()
  await db.schema.dropTable('agent_credentials').ifExists().execute()
  await db.schema.dropIndex('idx_credentials_provider_enabled').ifExists().execute()
  await db.schema.dropTable('credentials').ifExists().execute()
}
