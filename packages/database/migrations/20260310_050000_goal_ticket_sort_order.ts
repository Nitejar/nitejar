import { type Kysely, sql } from 'kysely'

/**
 * Add sort_order to goals and tickets for manual reordering.
 * Backfill existing rows with sequential sort_order based on created_at,
 * grouped by parent.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // 1. Add sort_order column to goals
  await db.schema
    .alterTable('goals')
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()

  // 2. Add sort_order column to tickets
  await db.schema
    .alterTable('tickets')
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()

  // 3. Backfill goals: sequential sort_order per parent group, ordered by created_at
  await sql`
    UPDATE goals
    SET sort_order = (
      SELECT COUNT(*)
      FROM goals AS g2
      WHERE coalesce(g2.parent_goal_id, '') = coalesce(goals.parent_goal_id, '')
        AND g2.created_at <= goals.created_at
        AND g2.id <> goals.id
    )
  `.execute(db)

  // 4. Backfill tickets: sequential sort_order per parent group, ordered by created_at
  await sql`
    UPDATE tickets
    SET sort_order = (
      SELECT COUNT(*)
      FROM tickets AS t2
      WHERE coalesce(t2.parent_ticket_id, '') = coalesce(tickets.parent_ticket_id, '')
        AND t2.created_at <= tickets.created_at
        AND t2.id <> tickets.id
    )
  `.execute(db)

  // 5. Create composite indexes
  await db.schema
    .createIndex('idx_goals_parent_sort')
    .on('goals')
    .columns(['parent_goal_id', 'sort_order'])
    .execute()

  await db.schema
    .createIndex('idx_tickets_parent_sort')
    .on('tickets')
    .columns(['parent_ticket_id', 'sort_order'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_tickets_parent_sort').ifExists().execute()
  await db.schema.dropIndex('idx_goals_parent_sort').ifExists().execute()
  await db.schema.alterTable('tickets').dropColumn('sort_order').execute()
  await db.schema.alterTable('goals').dropColumn('sort_order').execute()
}
