import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('goals')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('parent_goal_id', 'text', (col) => col.references('goals.id').onDelete('set null'))
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('outcome', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('draft'))
    .addColumn('owner_kind', 'text')
    .addColumn('owner_ref', 'text')
    .addColumn('created_by_user_id', 'text', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('archived_at', 'integer')
    .execute()

  await db.schema
    .createTable('tickets')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('goal_id', 'text', (col) => col.references('goals.id').onDelete('set null'))
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('body', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('inbox'))
    .addColumn('assignee_kind', 'text')
    .addColumn('assignee_ref', 'text')
    .addColumn('created_by_user_id', 'text', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('claimed_by_kind', 'text')
    .addColumn('claimed_by_ref', 'text')
    .addColumn('claimed_at', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('archived_at', 'integer')
    .execute()

  await db.schema
    .createTable('work_updates')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('goal_id', 'text', (col) => col.references('goals.id').onDelete('cascade'))
    .addColumn('ticket_id', 'text', (col) => col.references('tickets.id').onDelete('cascade'))
    .addColumn('author_kind', 'text', (col) => col.notNull())
    .addColumn('author_ref', 'text')
    .addColumn('kind', 'text', (col) => col.notNull().defaultTo('note'))
    .addColumn('body', 'text', (col) => col.notNull())
    .addColumn('metadata_json', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('ticket_links')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('ticket_id', 'text', (col) =>
      col.notNull().references('tickets.id').onDelete('cascade')
    )
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('ref', 'text', (col) => col.notNull())
    .addColumn('label', 'text')
    .addColumn('metadata_json', 'text')
    .addColumn('created_by_kind', 'text', (col) => col.notNull())
    .addColumn('created_by_ref', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_goals_status_updated_at')
    .ifNotExists()
    .on('goals')
    .columns(['status', 'updated_at'])
    .execute()

  await db.schema
    .createIndex('idx_goals_owner')
    .ifNotExists()
    .on('goals')
    .columns(['owner_kind', 'owner_ref'])
    .execute()

  await db.schema
    .createIndex('idx_goals_parent')
    .ifNotExists()
    .on('goals')
    .column('parent_goal_id')
    .execute()

  await db.schema
    .createIndex('idx_tickets_goal_status_updated_at')
    .ifNotExists()
    .on('tickets')
    .columns(['goal_id', 'status', 'updated_at'])
    .execute()

  await db.schema
    .createIndex('idx_tickets_assignee_status_updated_at')
    .ifNotExists()
    .on('tickets')
    .columns(['assignee_kind', 'assignee_ref', 'status', 'updated_at'])
    .execute()

  await db.schema
    .createIndex('idx_tickets_status_updated_at')
    .ifNotExists()
    .on('tickets')
    .columns(['status', 'updated_at'])
    .execute()

  await db.schema
    .createIndex('idx_work_updates_ticket_created_at')
    .ifNotExists()
    .on('work_updates')
    .columns(['ticket_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_work_updates_goal_created_at')
    .ifNotExists()
    .on('work_updates')
    .columns(['goal_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_work_updates_kind_created_at')
    .ifNotExists()
    .on('work_updates')
    .columns(['kind', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_ticket_links_ticket_kind')
    .ifNotExists()
    .on('ticket_links')
    .columns(['ticket_id', 'kind'])
    .execute()

  await db.schema
    .createIndex('idx_ticket_links_kind_ref')
    .ifNotExists()
    .on('ticket_links')
    .columns(['kind', 'ref'])
    .execute()

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_links_unique_ref ON ticket_links (ticket_id, kind, ref)`.execute(
    db
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_ticket_links_unique_ref`.execute(db)
  await db.schema.dropIndex('idx_ticket_links_kind_ref').ifExists().execute()
  await db.schema.dropIndex('idx_ticket_links_ticket_kind').ifExists().execute()
  await db.schema.dropIndex('idx_work_updates_kind_created_at').ifExists().execute()
  await db.schema.dropIndex('idx_work_updates_goal_created_at').ifExists().execute()
  await db.schema.dropIndex('idx_work_updates_ticket_created_at').ifExists().execute()
  await db.schema.dropIndex('idx_tickets_status_updated_at').ifExists().execute()
  await db.schema.dropIndex('idx_tickets_assignee_status_updated_at').ifExists().execute()
  await db.schema.dropIndex('idx_tickets_goal_status_updated_at').ifExists().execute()
  await db.schema.dropIndex('idx_goals_parent').ifExists().execute()
  await db.schema.dropIndex('idx_goals_owner').ifExists().execute()
  await db.schema.dropIndex('idx_goals_status_updated_at').ifExists().execute()
  await db.schema.dropTable('ticket_links').ifExists().execute()
  await db.schema.dropTable('work_updates').ifExists().execute()
  await db.schema.dropTable('tickets').ifExists().execute()
  await db.schema.dropTable('goals').ifExists().execute()
}
