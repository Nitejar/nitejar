import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  PLUGIN_INSTANCE_CUTOVER_MARKER_ID,
  PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE,
  PLUGIN_INSTANCE_CUTOVER_STATUS,
} from './plugin-instance-cutover'
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

function withDb(init: (path: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'nitejar-db-cutover-'))
  tempDirs.push(dir)
  const dbPath = join(dir, 'db.sqlite')
  init(dbPath)
  return dbPath
}

describe('database cutover guard', () => {
  it('allows startup when no legacy integrations table exists', () => {
    const dbPath = withDb((path) => {
      const db = new BetterSqlite3(path)
      db.exec('CREATE TABLE agents (id TEXT PRIMARY KEY)')
      db.close()
    })

    process.env.DATABASE_URL = dbPath
    expect(() => getDb()).not.toThrow()
  })

  it('fails startup when legacy integrations exist and marker table is missing', () => {
    const dbPath = withDb((path) => {
      const db = new BetterSqlite3(path)
      db.exec('CREATE TABLE integrations (id TEXT PRIMARY KEY)')
      db.close()
    })

    process.env.DATABASE_URL = dbPath
    expect(() => getDb()).toThrow(/Database cutover required/)
  })

  it('fails startup when marker is present but not completed', () => {
    const dbPath = withDb((path) => {
      const db = new BetterSqlite3(path)
      db.exec(`
        CREATE TABLE integrations (id TEXT PRIMARY KEY);
        CREATE TABLE ${PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE} (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          completed_at INTEGER NOT NULL,
          details_json TEXT
        );
        INSERT INTO ${PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE} (id, status, completed_at, details_json)
        VALUES ('${PLUGIN_INSTANCE_CUTOVER_MARKER_ID}', '${PLUGIN_INSTANCE_CUTOVER_STATUS.IN_PROGRESS}', 1, '{}');
      `)
      db.close()
    })

    process.env.DATABASE_URL = dbPath
    expect(() => getDb()).toThrow(/Database cutover incomplete/)
  })

  it('allows startup when marker status is completed', () => {
    const dbPath = withDb((path) => {
      const db = new BetterSqlite3(path)
      db.exec(`
        CREATE TABLE integrations (id TEXT PRIMARY KEY);
        CREATE TABLE ${PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE} (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          completed_at INTEGER NOT NULL,
          details_json TEXT
        );
        INSERT INTO ${PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE} (id, status, completed_at, details_json)
        VALUES ('${PLUGIN_INSTANCE_CUTOVER_MARKER_ID}', '${PLUGIN_INSTANCE_CUTOVER_STATUS.COMPLETED}', 1, '{}');
      `)
      db.close()
    })

    process.env.DATABASE_URL = dbPath
    expect(() => getDb()).not.toThrow()
  })
})
