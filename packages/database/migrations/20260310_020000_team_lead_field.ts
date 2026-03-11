import { type Kysely } from 'kysely'

/**
 * Add lead_kind + lead_ref directly to teams table.
 * A lead can be a user or an agent. This replaces the implicit
 * "find the team_member with role='lead'" pattern.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('teams')
    .addColumn('lead_kind', 'text') // 'user' | 'agent' | null
    .execute()

  await db.schema
    .alterTable('teams')
    .addColumn('lead_ref', 'text') // FK to users.id or agents.id
    .execute()

  // Backfill from existing team_members with role='lead'
  // (these are all users since that's how the old system worked)
  await db
    .updateTable('teams')
    .set((eb: any) => ({
      lead_kind: 'user',
      lead_ref: eb
        .selectFrom('team_members')
        .select('user_id')
        .whereRef('team_members.team_id', '=', 'teams.id')
        .where('team_members.role', '=', 'lead')
        .limit(1),
    }))
    .where((eb: any) =>
      eb.exists(
        eb
          .selectFrom('team_members')
          .select('user_id')
          .whereRef('team_members.team_id', '=', 'teams.id')
          .where('team_members.role', '=', 'lead')
      )
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('teams').dropColumn('lead_kind').execute()
  await db.schema.alterTable('teams').dropColumn('lead_ref').execute()
}
