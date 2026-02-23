import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // SQLite doesn't support DROP COLUMN — recreate the table without estimated_cost_usd
  await sql`CREATE TABLE inference_calls_new (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    turn INTEGER NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,
    cost_usd REAL,
    tool_call_names TEXT,
    finish_reason TEXT,
    is_fallback INTEGER DEFAULT 0,
    duration_ms INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`.execute(db)

  await sql`INSERT INTO inference_calls_new
    SELECT id, job_id, agent_id, turn, model, prompt_tokens, completion_tokens,
           total_tokens, cost_usd, tool_call_names, finish_reason, is_fallback,
           duration_ms, created_at
    FROM inference_calls`.execute(db)

  await sql`DROP TABLE inference_calls`.execute(db)
  await sql`ALTER TABLE inference_calls_new RENAME TO inference_calls`.execute(db)

  // Recreate indexes
  await db.schema
    .createIndex('idx_inference_calls_agent_created')
    .on('inference_calls')
    .columns(['agent_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_inference_calls_job')
    .on('inference_calls')
    .column('job_id')
    .execute()
}
