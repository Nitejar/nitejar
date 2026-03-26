import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from './db'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BetterSqlite3 = require('better-sqlite3') as new (path: string) => {
  exec: (sql: string) => void
  close: () => void
}

const tempDirs: string[] = []

afterEach(async () => {
  await closeDb()
  delete process.env.DATABASE_URL

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createLegacyDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nitejar-goal-heartbeat-migration-'))
  tempDirs.push(dir)
  const dbPath = join(dir, 'test.sqlite')
  const db = new BetterSqlite3(dbPath)
  db.exec(`
    CREATE TABLE goals (
      id TEXT PRIMARY KEY,
      owner_kind TEXT,
      owner_ref TEXT
    );

    CREATE TABLE routines (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at INTEGER,
      target_session_key TEXT NOT NULL,
      archived_at INTEGER
    );

    CREATE TABLE app_sessions (
      session_key TEXT PRIMARY KEY,
      primary_agent_id TEXT
    );

    INSERT INTO goals (id, owner_kind, owner_ref) VALUES
      ('goal-agent', 'agent', 'agent-new'),
      ('goal-human', 'user', 'user-1');

    INSERT INTO routines (id, agent_id, enabled, next_run_at, target_session_key, archived_at) VALUES
      ('routine-agent', 'agent-old', 1, 123, 'work:goal:goal-agent:heartbeat', NULL),
      ('routine-human', 'agent-stale', 1, 456, 'work:goal:goal-human:heartbeat', NULL);

    INSERT INTO app_sessions (session_key, primary_agent_id) VALUES
      ('work:goal:goal-agent:heartbeat', 'agent-old'),
      ('work:goal:goal-human:heartbeat', 'agent-stale');
  `)
  db.close()
  return dbPath
}

async function loadMigrationUp(): Promise<(db: unknown) => Promise<void>> {
  const modulePath = '../migrations/' + '20260325_020000_align_goal_heartbeat_routines_with_owner'
  const modUnknown: unknown = await import(modulePath)
  if (!modUnknown || typeof modUnknown !== 'object' || !('up' in modUnknown)) {
    throw new Error('Migration module did not expose an up() function')
  }

  const up = (modUnknown as { up: unknown }).up
  if (typeof up !== 'function') {
    throw new Error('Migration module did not expose an up() function')
  }

  return up as (db: unknown) => Promise<void>
}

describe('align goal heartbeat routines with owner migration', () => {
  it('moves goal heartbeats onto the current agent owner and disables non-agent owned loops', async () => {
    const dbPath = createLegacyDb()
    process.env.DATABASE_URL = dbPath
    const db = getDb()
    const applyMigration = await loadMigrationUp()

    await applyMigration(db as never)

    const agentRoutine = await db
      .selectFrom('routines')
      .select(['agent_id', 'enabled', 'next_run_at'])
      .where('id', '=', 'routine-agent')
      .executeTakeFirstOrThrow()

    const humanRoutine = await db
      .selectFrom('routines')
      .select(['agent_id', 'enabled', 'next_run_at'])
      .where('id', '=', 'routine-human')
      .executeTakeFirstOrThrow()

    const agentSession = await db
      .selectFrom('app_sessions')
      .select(['primary_agent_id'])
      .where('session_key', '=', 'work:goal:goal-agent:heartbeat')
      .executeTakeFirstOrThrow()

    expect(agentRoutine.agent_id).toBe('agent-new')
    expect(agentRoutine.enabled).toBe(1)
    expect(agentRoutine.next_run_at).toBe(123)
    expect(agentSession.primary_agent_id).toBe('agent-new')

    expect(humanRoutine.agent_id).toBe('agent-stale')
    expect(humanRoutine.enabled).toBe(0)
    expect(humanRoutine.next_run_at).toBeNull()
  })
})
