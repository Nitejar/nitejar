import { Kysely } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const authTimestampType = isPostgres ? 'timestamptz' : 'text'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('oauth_application')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('icon', 'text')
    .addColumn('metadata', 'text')
    .addColumn('client_id', 'text', (col) => col.notNull().unique())
    .addColumn('client_secret', 'text')
    .addColumn('redirect_urls', 'text', (col) => col.notNull())
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('disabled', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('user_id', 'text', (col) => col.references('users.id').onDelete('cascade'))
    .addColumn('created_at', authTimestampType as 'text', (col) => col.notNull())
    .addColumn('updated_at', authTimestampType as 'text', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('oauth_access_token')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('access_token', 'text', (col) => col.notNull().unique())
    .addColumn('refresh_token', 'text', (col) => col.notNull().unique())
    .addColumn('access_token_expires_at', authTimestampType as 'text', (col) => col.notNull())
    .addColumn('refresh_token_expires_at', authTimestampType as 'text', (col) => col.notNull())
    .addColumn('client_id', 'text', (col) =>
      col.notNull().references('oauth_application.client_id').onDelete('cascade')
    )
    .addColumn('user_id', 'text', (col) => col.references('users.id').onDelete('cascade'))
    .addColumn('scopes', 'text', (col) => col.notNull())
    .addColumn('created_at', authTimestampType as 'text', (col) => col.notNull())
    .addColumn('updated_at', authTimestampType as 'text', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('oauth_consent')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('client_id', 'text', (col) =>
      col.notNull().references('oauth_application.client_id').onDelete('cascade')
    )
    .addColumn('user_id', 'text', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('scopes', 'text', (col) => col.notNull())
    .addColumn('created_at', authTimestampType as 'text', (col) => col.notNull())
    .addColumn('updated_at', authTimestampType as 'text', (col) => col.notNull())
    .addColumn('consent_given', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()

  await db.schema
    .createIndex('idx_oauth_application_user')
    .ifNotExists()
    .on('oauth_application')
    .column('user_id')
    .execute()
  await db.schema
    .createIndex('idx_oauth_access_token_client')
    .ifNotExists()
    .on('oauth_access_token')
    .column('client_id')
    .execute()
  await db.schema
    .createIndex('idx_oauth_access_token_user')
    .ifNotExists()
    .on('oauth_access_token')
    .column('user_id')
    .execute()
  await db.schema
    .createIndex('idx_oauth_consent_client')
    .ifNotExists()
    .on('oauth_consent')
    .column('client_id')
    .execute()
  await db.schema
    .createIndex('idx_oauth_consent_user')
    .ifNotExists()
    .on('oauth_consent')
    .column('user_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_oauth_consent_user').ifExists().execute()
  await db.schema.dropIndex('idx_oauth_consent_client').ifExists().execute()
  await db.schema.dropIndex('idx_oauth_access_token_user').ifExists().execute()
  await db.schema.dropIndex('idx_oauth_access_token_client').ifExists().execute()
  await db.schema.dropIndex('idx_oauth_application_user').ifExists().execute()

  await db.schema.dropTable('oauth_consent').ifExists().execute()
  await db.schema.dropTable('oauth_access_token').ifExists().execute()
  await db.schema.dropTable('oauth_application').ifExists().execute()
}
