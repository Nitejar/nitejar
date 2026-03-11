import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('goals')
    .addColumn('progress_source', 'text', (col) => col.defaultTo('ticket_rollup').notNull())
    .execute()

  await db.schema.alterTable('goals').addColumn('progress_current', 'real').execute()

  await db.schema.alterTable('goals').addColumn('progress_target', 'real').execute()

  await db.schema.alterTable('goals').addColumn('progress_unit', 'text').execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // SQLite doesn't support DROP COLUMN before 3.35.0; recreate table approach
  // For local dev, dropping columns directly is fine with modern SQLite
  await sql`ALTER TABLE goals DROP COLUMN progress_source`.execute(db)
  await sql`ALTER TABLE goals DROP COLUMN progress_current`.execute(db)
  await sql`ALTER TABLE goals DROP COLUMN progress_target`.execute(db)
  await sql`ALTER TABLE goals DROP COLUMN progress_unit`.execute(db)
}
