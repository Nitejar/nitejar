import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // Add new columns to cost_limits
  await db.schema
    .alterTable('cost_limits')
    .addColumn('scope', 'text', (col) => col.notNull().defaultTo('agent'))
    .execute()

  await db.schema.alterTable('cost_limits').addColumn('team_id', 'text').execute()

  await db.schema
    .alterTable('cost_limits')
    .addColumn('soft_limit_pct', 'integer', (col) => col.notNull().defaultTo(100))
    .execute()

  await db.schema
    .alterTable('cost_limits')
    .addColumn('hard_limit_pct', 'integer', (col) => col.notNull().defaultTo(150))
    .execute()

  // SQLite doesn't support ALTER COLUMN to drop NOT NULL, but existing rows
  // all have agent_id set. New rows with scope='org' or scope='team' will
  // still need to pass a value — the code will handle this by passing null
  // since SQLite doesn't enforce NOT NULL on columns added via CREATE TABLE
  // when inserting via Kysely. For a clean approach, we recreate the table.
  // However, that's risky with data. Instead, we note that SQLite's ALTER TABLE
  // ADD COLUMN doesn't support constraints well, and the original CREATE TABLE
  // used col.notNull() which IS enforced. We'll work around this by using
  // a pragma + temp table approach.

  // Actually, SQLite ALTER TABLE cannot drop NOT NULL. The simplest approach:
  // Create a new table, copy data, drop old, rename new.
  await sql`CREATE TABLE cost_limits_new (
    id TEXT PRIMARY KEY,
    agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    limit_usd REAL NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    scope TEXT NOT NULL DEFAULT 'agent',
    team_id TEXT,
    soft_limit_pct INTEGER NOT NULL DEFAULT 100,
    hard_limit_pct INTEGER NOT NULL DEFAULT 150
  )`.execute(db)

  await sql`INSERT INTO cost_limits_new
    SELECT id, agent_id, period, limit_usd, enabled, created_at, updated_at,
           scope, team_id, soft_limit_pct, hard_limit_pct
    FROM cost_limits`.execute(db)

  await sql`DROP TABLE cost_limits`.execute(db)
  await sql`ALTER TABLE cost_limits_new RENAME TO cost_limits`.execute(db)

  // Recreate indexes
  await db.schema
    .createIndex('idx_cost_limits_agent')
    .ifNotExists()
    .on('cost_limits')
    .column('agent_id')
    .execute()

  await db.schema
    .createIndex('idx_cost_limits_scope_team')
    .ifNotExists()
    .on('cost_limits')
    .columns(['scope', 'team_id'])
    .execute()
}
