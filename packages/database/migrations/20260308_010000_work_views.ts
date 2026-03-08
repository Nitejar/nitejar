import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('work_views')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('owner_user_id', 'text', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('scope', 'text', (col) => col.notNull().defaultTo('user'))
    .addColumn('entity_kind', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('filters_json', 'text', (col) => col.notNull())
    .addColumn('sort_json', 'text')
    .addColumn('group_by', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_work_views_owner_entity')
    .ifNotExists()
    .on('work_views')
    .columns(['owner_user_id', 'entity_kind', 'updated_at'])
    .execute()

  await db.schema
    .createIndex('idx_work_views_scope_entity')
    .ifNotExists()
    .on('work_views')
    .columns(['scope', 'entity_kind'])
    .execute()

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_work_views_owner_entity_name ON work_views (owner_user_id, entity_kind, name)`.execute(
    db
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_work_views_owner_entity_name`.execute(db)
  await db.schema.dropIndex('idx_work_views_scope_entity').ifExists().execute()
  await db.schema.dropIndex('idx_work_views_owner_entity').ifExists().execute()
  await db.schema.dropTable('work_views').ifExists().execute()
}
