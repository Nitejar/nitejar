import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const authTimestampType = isPostgres ? 'timestamptz' : 'text'
const unixNow = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('team_members').ifExists().execute()
  await db.schema.dropTable('invitations').ifExists().execute()
  await db.schema.dropTable('account').ifExists().execute()
  await db.schema.dropTable('session').ifExists().execute()
  await db.schema.dropTable('verification').ifExists().execute()
  await db.schema.dropTable('users').ifExists().execute()

  await db.schema
    .createTable('users')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('email_verified', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('avatar_url', 'text')
    .addColumn('created_at', authTimestampType as 'text', (col) => col.notNull())
    .addColumn('updated_at', authTimestampType as 'text', (col) => col.notNull())
    .addColumn('role', 'text', (col) => col.notNull().defaultTo('member'))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('active'))
    .execute()

  await db.schema
    .createTable('session')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('expires_at', authTimestampType as 'text', (col) => col.notNull())
    .addColumn('token', 'text', (col) => col.notNull().unique())
    .addColumn('created_at', authTimestampType as 'text', (col) => col.notNull())
    .addColumn('updated_at', authTimestampType as 'text', (col) => col.notNull())
    .addColumn('ip_address', 'text')
    .addColumn('user_agent', 'text')
    .addColumn('user_id', 'text', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .execute()

  await db.schema
    .createTable('account')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('account_id', 'text', (col) => col.notNull())
    .addColumn('provider_id', 'text', (col) => col.notNull())
    .addColumn('user_id', 'text', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('access_token', 'text')
    .addColumn('refresh_token', 'text')
    .addColumn('id_token', 'text')
    .addColumn('access_token_expires_at', authTimestampType as 'text')
    .addColumn('refresh_token_expires_at', authTimestampType as 'text')
    .addColumn('scope', 'text')
    .addColumn('password_hash', 'text')
    .addColumn('created_at', authTimestampType as 'text', (col) => col.notNull())
    .addColumn('updated_at', authTimestampType as 'text', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('verification')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('identifier', 'text', (col) => col.notNull())
    .addColumn('value', 'text', (col) => col.notNull())
    .addColumn('expires_at', authTimestampType as 'text', (col) => col.notNull())
    .addColumn('created_at', authTimestampType as 'text', (col) => col.notNull())
    .addColumn('updated_at', authTimestampType as 'text', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('invitations')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('token_hash', 'text', (col) => col.notNull())
    .addColumn('avatar_url', 'text')
    .addColumn('role', 'text', (col) => col.notNull().defaultTo('member'))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('expires_at', 'integer')
    .addColumn('accepted_at', 'integer')
    .addColumn('created_by_user_id', 'text', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(unixNow))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(unixNow))
    .execute()

  await db.schema
    .createTable('team_members')
    .ifNotExists()
    .addColumn('team_id', 'text', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('user_id', 'text', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('role', 'text', (col) => col.notNull().defaultTo('member'))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(unixNow))
    .addPrimaryKeyConstraint('team_members_pk', ['team_id', 'user_id'])
    .execute()

  await db.schema
    .createIndex('idx_session_user_id')
    .ifNotExists()
    .on('session')
    .column('user_id')
    .execute()
  await db.schema
    .createIndex('idx_account_user_id')
    .ifNotExists()
    .on('account')
    .column('user_id')
    .execute()
  await db.schema
    .createIndex('idx_verification_identifier')
    .ifNotExists()
    .on('verification')
    .column('identifier')
    .execute()
  await db.schema
    .createIndex('idx_invitations_token_hash')
    .ifNotExists()
    .on('invitations')
    .column('token_hash')
    .unique()
    .execute()
  await db.schema
    .createIndex('idx_invitations_status')
    .ifNotExists()
    .on('invitations')
    .column('status')
    .execute()
  await db.schema
    .createIndex('idx_invitations_email')
    .ifNotExists()
    .on('invitations')
    .column('email')
    .execute()
  await db.schema
    .createIndex('idx_team_members_user')
    .ifNotExists()
    .on('team_members')
    .column('user_id')
    .execute()
  await db.schema
    .createIndex('idx_team_members_team')
    .ifNotExists()
    .on('team_members')
    .column('team_id')
    .execute()
}
