import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('org_units')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('parent_org_unit_id', 'text', (col) =>
      col.references('org_units.id').onDelete('set null')
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('slug', 'text')
    .addColumn('description', 'text')
    .addColumn('kind', 'text', (col) => col.notNull().defaultTo('team'))
    .addColumn('owner_kind', 'text')
    .addColumn('owner_ref', 'text')
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .alterTable('teams')
    .addColumn('org_unit_id', 'text', (col) => col.references('org_units.id').onDelete('set null'))
    .execute()

  await db.schema
    .createIndex('idx_org_units_parent_sort')
    .ifNotExists()
    .on('org_units')
    .columns(['parent_org_unit_id', 'sort_order'])
    .execute()

  await db.schema
    .createIndex('idx_teams_org_unit')
    .ifNotExists()
    .on('teams')
    .column('org_unit_id')
    .execute()

  await db.schema
    .createTable('initiatives')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('parent_initiative_id', 'text', (col) =>
      col.references('initiatives.id').onDelete('set null')
    )
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('slug', 'text')
    .addColumn('description', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('active'))
    .addColumn('owner_kind', 'text')
    .addColumn('owner_ref', 'text')
    .addColumn('team_id', 'text', (col) => col.references('teams.id').onDelete('set null'))
    .addColumn('target_label', 'text')
    .addColumn('created_by_user_id', 'text', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('archived_at', 'integer')
    .execute()

  await db.schema
    .alterTable('goals')
    .addColumn('initiative_id', 'text', (col) =>
      col.references('initiatives.id').onDelete('set null')
    )
    .execute()

  await db.schema
    .createIndex('idx_initiatives_parent_status')
    .ifNotExists()
    .on('initiatives')
    .columns(['parent_initiative_id', 'status'])
    .execute()

  await db.schema
    .createIndex('idx_goals_initiative_status')
    .ifNotExists()
    .on('goals')
    .columns(['initiative_id', 'status'])
    .execute()

  await db.schema
    .alterTable('tickets')
    .addColumn('parent_ticket_id', 'text', (col) =>
      col.references('tickets.id').onDelete('set null')
    )
    .execute()

  await db.schema
    .createIndex('idx_tickets_parent_status')
    .ifNotExists()
    .on('tickets')
    .columns(['parent_ticket_id', 'status'])
    .execute()

  await db.schema
    .createTable('ticket_relations')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('ticket_id', 'text', (col) =>
      col.notNull().references('tickets.id').onDelete('cascade')
    )
    .addColumn('related_ticket_id', 'text', (col) =>
      col.notNull().references('tickets.id').onDelete('cascade')
    )
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('created_by_kind', 'text', (col) => col.notNull())
    .addColumn('created_by_ref', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_ticket_relations_ticket_kind')
    .ifNotExists()
    .on('ticket_relations')
    .columns(['ticket_id', 'kind'])
    .execute()

  await db.schema
    .createIndex('idx_ticket_relations_related_kind')
    .ifNotExists()
    .on('ticket_relations')
    .columns(['related_ticket_id', 'kind'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_ticket_relations_related_kind').ifExists().execute()
  await db.schema.dropIndex('idx_ticket_relations_ticket_kind').ifExists().execute()
  await db.schema.dropTable('ticket_relations').ifExists().execute()
  await db.schema.dropIndex('idx_tickets_parent_status').ifExists().execute()
  await db.schema.alterTable('tickets').dropColumn('parent_ticket_id').execute()
  await db.schema.dropIndex('idx_goals_initiative_status').ifExists().execute()
  await db.schema.dropIndex('idx_initiatives_parent_status').ifExists().execute()
  await db.schema.alterTable('goals').dropColumn('initiative_id').execute()
  await db.schema.dropTable('initiatives').ifExists().execute()
  await db.schema.dropIndex('idx_teams_org_unit').ifExists().execute()
  await db.schema.dropIndex('idx_org_units_parent_sort').ifExists().execute()
  await db.schema.alterTable('teams').dropColumn('org_unit_id').execute()
  await db.schema.dropTable('org_units').ifExists().execute()
}
