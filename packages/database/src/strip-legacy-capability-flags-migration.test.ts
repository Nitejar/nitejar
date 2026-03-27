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
  const dir = mkdtempSync(join(tmpdir(), 'nitejar-strip-legacy-capability-flags-'))
  tempDirs.push(dir)
  const dbPath = join(dir, 'test.sqlite')
  const db = new BetterSqlite3(dbPath)
  db.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      name TEXT NOT NULL,
      sprite_id TEXT,
      config TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    INSERT INTO agents (id, handle, name, config, status, created_at, updated_at) VALUES
      (
        'agent-legacy',
        'legacy',
        'Legacy Agent',
        '{"model":"test-model","allowEphemeralSandboxCreation":true,"allowRoutineManagement":true,"dangerouslyUnrestricted":true,"memorySettings":{"enabled":true}}',
        'idle',
        1,
        1
      ),
      (
        'agent-invalid',
        'invalid',
        'Invalid Agent',
        'not-json',
        'idle',
        1,
        1
      );
  `)
  db.close()
  return dbPath
}

async function loadMigrationUp(): Promise<(db: unknown) => Promise<void>> {
  const modulePath =
    '../migrations/' + '20260326_020000_strip_legacy_capability_flags_from_agent_config'
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

describe('strip legacy capability flags migration', () => {
  it('removes legacy capability keys from stored agent config blobs', async () => {
    const dbPath = createLegacyDb()
    process.env.DATABASE_URL = dbPath
    const db = getDb()
    const applyMigration = await loadMigrationUp()

    await applyMigration(db as never)

    const migrated = await db
      .selectFrom('agents')
      .select(['config'])
      .where('id', '=', 'agent-legacy')
      .executeTakeFirstOrThrow()

    expect(JSON.parse(migrated.config ?? '{}')).toEqual({
      model: 'test-model',
      memorySettings: { enabled: true },
    })

    const untouched = await db
      .selectFrom('agents')
      .select(['config'])
      .where('id', '=', 'agent-invalid')
      .executeTakeFirstOrThrow()

    expect(untouched.config).toBe('not-json')
  })
})
