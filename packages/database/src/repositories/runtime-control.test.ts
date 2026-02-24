import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '../db'
import { getRuntimeControl } from './runtime-control'

let testDir = ''
let db: ReturnType<typeof getDb>

function now(): number {
  return Math.floor(Date.now() / 1000)
}

async function createTestSchema(database: ReturnType<typeof getDb>): Promise<void> {
  await database.schema
    .createTable('runtime_control')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('processing_enabled', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('pause_mode', 'text', (col) => col.notNull().defaultTo('soft'))
    .addColumn('pause_reason', 'text')
    .addColumn('paused_by', 'text')
    .addColumn('paused_at', 'integer')
    .addColumn('control_epoch', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('max_concurrent_dispatches', 'integer', (col) => col.notNull().defaultTo(20))
    .addColumn('app_base_url', 'text')
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(now()))
    .execute()
}

describe('runtime control repository', () => {
  beforeAll(async () => {
    await closeDb()
    testDir = mkdtempSync(join(tmpdir(), 'nitejar-runtime-control-'))
    process.env.DATABASE_URL = join(testDir, 'test.sqlite')
    db = getDb()
    await createTestSchema(db)
  })

  afterAll(async () => {
    await closeDb()
    delete process.env.DATABASE_URL
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await db.deleteFrom('runtime_control').execute()
  })

  it('initializes runtime control safely under concurrent calls', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => getRuntimeControl()))

    expect(results).toHaveLength(20)
    for (const control of results) {
      expect(control.id).toBe('default')
      expect(control.processing_enabled).toBe(1)
      expect(control.max_concurrent_dispatches).toBe(20)
      expect(control.app_base_url).toBeNull()
    }

    const rows = await db.selectFrom('runtime_control').selectAll().execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('default')
  })
})
