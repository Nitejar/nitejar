import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('collections')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('schema_json', 'text', (col) => col.notNull())
    .addColumn('schema_version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_by_agent_id', 'text', (col) =>
      col.references('agents.id').onDelete('set null')
    )
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addUniqueConstraint('collections_name_unique', ['name'])
    .execute()

  await db.schema
    .createTable('collection_rows')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('collection_id', 'text', (col) =>
      col.notNull().references('collections.id').onDelete('cascade')
    )
    .addColumn('data_json', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('content_json', 'text')
    .addColumn('search_text', 'text')
    .addColumn('created_by_agent_id', 'text', (col) =>
      col.references('agents.id').onDelete('set null')
    )
    .addColumn('updated_by_agent_id', 'text', (col) =>
      col.references('agents.id').onDelete('set null')
    )
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('collection_permissions')
    .ifNotExists()
    .addColumn('collection_id', 'text', (col) =>
      col.notNull().references('collections.id').onDelete('cascade')
    )
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('can_read', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('can_write', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addPrimaryKeyConstraint('collection_permissions_pk', ['collection_id', 'agent_id'])
    .execute()

  await db.schema
    .createTable('collection_schema_reviews')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('collection_id', 'text', (col) =>
      col.references('collections.id').onDelete('set null')
    )
    .addColumn('collection_name', 'text', (col) => col.notNull())
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('requested_by_agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('proposed_description', 'text')
    .addColumn('proposed_schema_json', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('reviewed_by_user_id', 'text', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('review_notes', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('reviewed_at', 'integer')
    .addColumn('applied_at', 'integer')
    .execute()

  await db.schema
    .createIndex('idx_collection_rows_collection')
    .ifNotExists()
    .on('collection_rows')
    .column('collection_id')
    .execute()

  await db.schema
    .createIndex('idx_collection_rows_collection_updated')
    .ifNotExists()
    .on('collection_rows')
    .columns(['collection_id', 'updated_at'])
    .execute()

  await db.schema
    .createIndex('idx_collection_permissions_agent')
    .ifNotExists()
    .on('collection_permissions')
    .column('agent_id')
    .execute()

  await db.schema
    .createIndex('idx_collection_schema_reviews_status_created')
    .ifNotExists()
    .on('collection_schema_reviews')
    .columns(['status', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_collection_schema_reviews_collection_name')
    .ifNotExists()
    .on('collection_schema_reviews')
    .column('collection_name')
    .execute()
}
