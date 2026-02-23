import { Kysely, sql } from 'kysely'

/**
 * Replace rigid auth_location ('header'|'query') + allow_manual_auth_headers
 * with three independent permission flags: allowed_in_header, allowed_in_query, allowed_in_body.
 *
 * The agent can use the credential wherever a flag is set. The runtime auto-injects
 * into the first allowed location (header > query). Body is a future capability.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const isPostgres =
    (process.env.DATABASE_URL || '').startsWith('postgres://') ||
    (process.env.DATABASE_URL || '').startsWith('postgresql://')

  const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

  // Recreate the table with the new schema (SQLite-safe column migration)
  await db.schema
    .createTable('credentials_new')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('alias', 'text', (col) => col.notNull().unique())
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('auth_type', 'text', (col) => col.notNull().defaultTo('api_key'))
    .addColumn('secret_encrypted', 'text', (col) => col.notNull())
    .addColumn('auth_key', 'text', (col) => col.notNull())
    .addColumn('auth_scheme', 'text')
    .addColumn('allowed_hosts', 'text', (col) => col.notNull())
    .addColumn('enabled', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('allowed_in_header', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('allowed_in_query', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('allowed_in_body', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  // Migrate existing data: auth_location -> allowed_in_* flags
  await sql`
    INSERT INTO credentials_new (
      id, alias, provider, auth_type, secret_encrypted,
      auth_key, auth_scheme, allowed_hosts, enabled,
      allowed_in_header, allowed_in_query, allowed_in_body,
      created_at, updated_at
    )
    SELECT
      id, alias, provider, auth_type, secret_encrypted,
      auth_key, auth_scheme, allowed_hosts, enabled,
      CASE WHEN auth_location = 'header' THEN 1 ELSE 0 END,
      CASE WHEN auth_location = 'query' THEN 1 ELSE 0 END,
      0,
      created_at, updated_at
    FROM credentials
  `.execute(db)

  await db.schema.dropIndex('idx_credentials_provider_enabled').ifExists().execute()
  await db.schema.dropTable('credentials').execute()
  await sql`ALTER TABLE credentials_new RENAME TO credentials`.execute(db)

  await db.schema
    .createIndex('idx_credentials_provider_enabled')
    .on('credentials')
    .columns(['provider', 'enabled'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const isPostgres =
    (process.env.DATABASE_URL || '').startsWith('postgres://') ||
    (process.env.DATABASE_URL || '').startsWith('postgresql://')

  const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

  await db.schema
    .createTable('credentials_old')
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

  await sql`
    INSERT INTO credentials_old (
      id, alias, provider, auth_type, secret_encrypted,
      auth_location, auth_key, auth_scheme, allowed_hosts, enabled,
      allow_manual_auth_headers, created_at, updated_at
    )
    SELECT
      id, alias, provider, auth_type, secret_encrypted,
      CASE WHEN allowed_in_query = 1 THEN 'query' ELSE 'header' END,
      auth_key, auth_scheme, allowed_hosts, enabled,
      1, created_at, updated_at
    FROM credentials
  `.execute(db)

  await db.schema.dropIndex('idx_credentials_provider_enabled').ifExists().execute()
  await db.schema.dropTable('credentials').execute()
  await sql`ALTER TABLE credentials_old RENAME TO credentials`.execute(db)

  await db.schema
    .createIndex('idx_credentials_provider_enabled')
    .on('credentials')
    .columns(['provider', 'enabled'])
    .execute()
}
