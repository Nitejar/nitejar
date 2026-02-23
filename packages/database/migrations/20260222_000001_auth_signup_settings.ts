import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const unixNow = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('auth_signup_settings')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('mode', 'text', (col) => col.notNull().defaultTo('invite_only'))
    .addColumn('approved_domains', 'text', (col) => col.notNull().defaultTo('[]'))
    .addColumn('default_role', 'text', (col) => col.notNull().defaultTo('member'))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(unixNow))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(unixNow))
    .execute()
}
