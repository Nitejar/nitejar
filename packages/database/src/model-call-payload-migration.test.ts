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
  const dir = mkdtempSync(join(tmpdir(), 'nitejar-migration-'))
  tempDirs.push(dir)
  const dbPath = join(dir, 'test.sqlite')
  const db = new BetterSqlite3(dbPath)
  db.exec(`
    CREATE TABLE jobs (id TEXT PRIMARY KEY);
    INSERT INTO jobs (id) VALUES ('job-1');

    CREATE TABLE inference_calls (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      turn INTEGER NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL,
      tool_call_names TEXT,
      finish_reason TEXT,
      is_fallback INTEGER DEFAULT 0,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL
    );

    INSERT INTO inference_calls (
      id, job_id, agent_id, turn, model,
      prompt_tokens, completion_tokens, total_tokens,
      cache_read_tokens, cache_write_tokens,
      cost_usd, tool_call_names, finish_reason, is_fallback, duration_ms, created_at
    ) VALUES (
      'call-1', 'job-1', 'agent-1', 1, 'legacy-model',
      10, 20, 30,
      0, 0,
      0.12, NULL, 'stop', 0, 101, 1
    );
  `)
  db.close()
  return dbPath
}

async function loadMigrationUp(): Promise<(db: unknown) => Promise<void>> {
  const modulePath = '../migrations/' + '20260303_000000_model_call_payload_receipts'
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

describe('model payload receipts migration', () => {
  it('adds additive payload columns and marks existing rows as legacy_unavailable', async () => {
    const dbPath = createLegacyDb()
    process.env.DATABASE_URL = dbPath
    const db = getDb()
    const applyModelPayloadMigration = await loadMigrationUp()

    await applyModelPayloadMigration(db as never)

    const row = await db
      .selectFrom('inference_calls')
      .select([
        'id',
        'model',
        'request_payload_hash',
        'response_payload_hash',
        'attempt_kind',
        'attempt_index',
        'payload_state',
        'model_span_id',
      ])
      .where('id', '=', 'call-1')
      .executeTakeFirstOrThrow()

    expect(row.model).toBe('legacy-model')
    expect(row.request_payload_hash).toBeNull()
    expect(row.response_payload_hash).toBeNull()
    expect(row.attempt_kind).toBeNull()
    expect(row.attempt_index).toBeNull()
    expect(row.model_span_id).toBeNull()
    expect(row.payload_state).toBe('legacy_unavailable')

    await db
      .insertInto('model_call_payloads')
      .values({
        hash: 'hash-1',
        payload_json: '{"hello":"world"}',
        metadata_json: '{"source":"test"}',
        byte_size: 17,
        created_at: 1,
      })
      .execute()

    const payloadCount = await db
      .selectFrom('model_call_payloads')
      .select((eb) => eb.fn.count<string>('hash').as('count'))
      .executeTakeFirstOrThrow()
    expect(Number(payloadCount.count)).toBe(1)
  })
})
