import { type Kysely, sql } from 'kysely'

/**
 * Merge org_units into teams.
 *
 * Every org_unit becomes a team. Existing teams that pointed at an org_unit
 * via `org_unit_id` now point at the converted team via `parent_team_id`.
 * The `org_units` table is dropped.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // 1. Add new columns to teams
  await db.schema
    .alterTable('teams')
    .addColumn('parent_team_id', 'text', (col) => col.references('teams.id').onDelete('set null'))
    .execute()

  await db.schema
    .alterTable('teams')
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()

  // 2. Copy org_units into teams (using the same id so FK references stay valid)
  await sql`
    INSERT INTO teams (id, name, description, slug, parent_team_id, sort_order, created_at, updated_at)
    SELECT id, name, description, slug,
           parent_org_unit_id,  -- becomes parent_team_id (same ids)
           sort_order,
           created_at, updated_at
    FROM org_units
  `.execute(db)

  // 3. Point existing teams at their former org_unit (now a team) via parent_team_id
  await sql`
    UPDATE teams
    SET parent_team_id = org_unit_id
    WHERE org_unit_id IS NOT NULL
  `.execute(db)

  // 4. Drop indexes that reference org_unit_id before dropping the column
  await db.schema.dropIndex('idx_teams_org_unit').ifExists().execute()

  // 5. Drop the old FK column
  await db.schema.alterTable('teams').dropColumn('org_unit_id').execute()

  // 6. Add index on parent_team_id
  await db.schema
    .createIndex('idx_teams_parent_sort')
    .on('teams')
    .columns(['parent_team_id', 'sort_order'])
    .execute()

  // 7. Drop org_units table and its indexes
  await db.schema.dropIndex('idx_org_units_parent_sort').ifExists().execute()
  await db.schema.dropTable('org_units').ifExists().execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  // Recreate org_units table
  await db.schema
    .createTable('org_units')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('parent_org_unit_id', 'text', (col) =>
      col.references('org_units.id').onDelete('set null')
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('slug', 'text')
    .addColumn('description', 'text')
    .addColumn('kind', 'text', (col) => col.notNull().defaultTo('department'))
    .addColumn('owner_kind', 'text')
    .addColumn('owner_ref', 'text')
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(sql`(unixepoch())`))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(sql`(unixepoch())`))
    .execute()

  await db.schema
    .createIndex('idx_org_units_parent_sort')
    .on('org_units')
    .columns(['parent_org_unit_id', 'sort_order'])
    .execute()

  // Add org_unit_id back to teams
  await db.schema
    .alterTable('teams')
    .addColumn('org_unit_id', 'text', (col) => col.references('org_units.id').onDelete('set null'))
    .execute()

  await db.schema.createIndex('idx_teams_org_unit').on('teams').column('org_unit_id').execute()

  // Drop new columns
  await db.schema.dropIndex('idx_teams_parent_sort').ifExists().execute()
  await db.schema.alterTable('teams').dropColumn('parent_team_id').execute()
  await db.schema.alterTable('teams').dropColumn('sort_order').execute()
}
