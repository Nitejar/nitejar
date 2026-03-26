import { type Kysely, sql } from 'kysely'

type TableInfoRow = {
  name: string
}

async function hasIsPrimaryColumn(db: Kysely<unknown>): Promise<boolean> {
  const result = await sql<TableInfoRow>`PRAGMA table_info('agent_teams')`.execute(db)
  return result.rows.some((row) => row.name === 'is_primary')
}

export async function up(db: Kysely<unknown>): Promise<void> {
  if (!(await hasIsPrimaryColumn(db))) return

  await sql`CREATE TABLE agent_teams_new (
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    CONSTRAINT agent_teams_pk PRIMARY KEY (team_id, agent_id)
  )`.execute(db)

  await sql`INSERT INTO agent_teams_new (team_id, agent_id, created_at)
    SELECT team_id, agent_id, created_at
    FROM agent_teams`.execute(db)

  await sql`DROP TABLE agent_teams`.execute(db)
  await sql`ALTER TABLE agent_teams_new RENAME TO agent_teams`.execute(db)

  await db.schema
    .createIndex('idx_agent_teams_agent')
    .ifNotExists()
    .on('agent_teams')
    .column('agent_id')
    .execute()

  await db.schema
    .createIndex('idx_agent_teams_team')
    .ifNotExists()
    .on('agent_teams')
    .column('team_id')
    .execute()

  await db.schema
    .createIndex('idx_agent_one_team')
    .ifNotExists()
    .on('agent_teams')
    .column('agent_id')
    .unique()
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  if (await hasIsPrimaryColumn(db)) return

  await sql`CREATE TABLE agent_teams_old (
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    CONSTRAINT agent_teams_pk PRIMARY KEY (team_id, agent_id)
  )`.execute(db)

  await sql`INSERT INTO agent_teams_old (team_id, agent_id, is_primary, created_at)
    SELECT team_id, agent_id, 0, created_at
    FROM agent_teams`.execute(db)

  await sql`DROP TABLE agent_teams`.execute(db)
  await sql`ALTER TABLE agent_teams_old RENAME TO agent_teams`.execute(db)

  await db.schema
    .createIndex('idx_agent_teams_agent')
    .ifNotExists()
    .on('agent_teams')
    .column('agent_id')
    .execute()

  await db.schema
    .createIndex('idx_agent_teams_team')
    .ifNotExists()
    .on('agent_teams')
    .column('team_id')
    .execute()

  await db.schema
    .createIndex('idx_agent_one_team')
    .ifNotExists()
    .on('agent_teams')
    .column('agent_id')
    .unique()
    .execute()
}
