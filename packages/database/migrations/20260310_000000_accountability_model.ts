import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Enforce one team per agent: delete duplicates keeping is_primary=1 row
  await sql`
    DELETE FROM agent_teams
    WHERE rowid NOT IN (
      SELECT MIN(rowid) FROM agent_teams
      WHERE is_primary = 1
      GROUP BY agent_id
      UNION
      SELECT MIN(rowid) FROM agent_teams
      WHERE agent_id NOT IN (SELECT agent_id FROM agent_teams WHERE is_primary = 1)
      GROUP BY agent_id
    )
  `.execute(db)

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_one_team ON agent_teams(agent_id)`.execute(
    db
  )

  // 2. Enforce one lead per team via partial unique index
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_team_one_lead ON team_members(team_id) WHERE role = 'lead'`.execute(
    db
  )

  // 3. Migrate team-owned goals to unowned
  await sql`UPDATE goals SET owner_kind = NULL, owner_ref = NULL WHERE owner_kind = 'team'`.execute(
    db
  )

  // 4. Migrate team-assigned tickets to unassigned
  await sql`UPDATE tickets SET assignee_kind = NULL, assignee_ref = NULL WHERE assignee_kind = 'team'`.execute(
    db
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_team_one_lead`.execute(db)
  await sql`DROP INDEX IF EXISTS idx_agent_one_team`.execute(db)
  // Data migrations (goals/tickets nulling) are not reversible
}
