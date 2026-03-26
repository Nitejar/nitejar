import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_goals_initiative_status').ifExists().execute()
  await db.schema.dropIndex('idx_initiatives_parent_status').ifExists().execute()
  await db.schema.alterTable('goals').dropColumn('initiative_id').execute()
  await db.schema.dropTable('initiatives').ifExists().execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
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
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(0))
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
}
