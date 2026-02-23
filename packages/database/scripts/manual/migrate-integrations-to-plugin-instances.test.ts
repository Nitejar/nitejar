import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  PLUGIN_INSTANCE_CUTOVER_MARKER_ID,
  PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE,
  PLUGIN_INSTANCE_CUTOVER_STATUS,
} from '../../src/plugin-instance-cutover.js'
import { migrateIntegrationsToPluginInstances } from './migrate-integrations-to-plugin-instances'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BetterSqlite3 = require('better-sqlite3') as new (path: string) => {
  prepare: (sql: string) => {
    get: (...params: unknown[]) => Record<string, unknown> | undefined
    all: (...params: unknown[]) => Array<Record<string, unknown>>
    run: (...params: unknown[]) => { changes: number }
  }
  exec: (sql: string) => void
  close: () => void
}

type SqliteDb = InstanceType<typeof BetterSqlite3>

function createLegacySchema(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE plugins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      trust_level TEXT NOT NULL DEFAULT 'unknown',
      source_kind TEXT NOT NULL,
      source_ref TEXT,
      current_version TEXT,
      current_checksum TEXT,
      current_install_path TEXT,
      manifest_json TEXT NOT NULL,
      config_json TEXT,
      last_load_error TEXT,
      last_loaded_at INTEGER,
      installed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE integrations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT,
      scope TEXT NOT NULL DEFAULT 'global',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE agent_integrations (
      agent_id TEXT NOT NULL,
      integration_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE work_items (
      id TEXT PRIMARY KEY,
      integration_id TEXT,
      title TEXT NOT NULL
    );
  `)
}

function latestBackupReport(dbPath: string): string {
  const backupsDir = join(dirname(dbPath), 'backups')
  const dirs = readdirSync(backupsDir)
    .map((entry) => join(backupsDir, entry))
    .sort((a, b) => a.localeCompare(b))
  return join(dirs[dirs.length - 1] || '', 'backup-report.json')
}

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('manual integration -> plugin-instance cutover', () => {
  it('migrates legacy tables, preserves ids/config, backfills FKs, and writes marker/report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nitejar-cutover-success-'))
    tempDirs.push(dir)
    const dbPath = join(dir, 'db.sqlite')

    const db = new BetterSqlite3(dbPath)
    createLegacySchema(db)

    db.prepare(
      `INSERT INTO integrations (id, type, name, config, scope, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('integration-1', 'telegram', 'Telegram Inbox', '{"bot":"abc"}', 'global', 1, 10, 20)

    db.prepare(
      `INSERT INTO agent_integrations (agent_id, integration_id, created_at) VALUES (?, ?, ?)`
    ).run('agent-1', 'integration-1', 15)

    db.prepare(`INSERT INTO work_items (id, integration_id, title) VALUES (?, ?, ?)`).run(
      'work-1',
      'integration-1',
      'Legacy work item'
    )

    db.close()

    const result = migrateIntegrationsToPluginInstances({ dbPath })
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') {
      throw new Error('Expected completed status')
    }

    expect(existsSync(result.report.backupSql)).toBe(true)
    expect(existsSync(result.report.reportPath)).toBe(true)

    const backupSql = readFileSync(result.report.backupSql, 'utf8')
    expect(backupSql).toContain('CREATE TABLE integrations')

    const reportJson = JSON.parse(readFileSync(result.report.reportPath, 'utf8')) as {
      status: string
      marker: { status: string }
      verification: { configHashesMatch: boolean }
    }
    expect(reportJson.status).toBe('completed')
    expect(reportJson.marker.status).toBe(PLUGIN_INSTANCE_CUTOVER_STATUS.COMPLETED)
    expect(reportJson.verification.configHashesMatch).toBe(true)

    const migrated = new BetterSqlite3(dbPath)

    const pluginInstance = migrated
      .prepare('SELECT id, plugin_id, config_json FROM plugin_instances WHERE id = ?')
      .get('integration-1') as { id: string; plugin_id: string; config_json: string }
    expect(pluginInstance.id).toBe('integration-1')
    expect(pluginInstance.plugin_id).toBe('builtin.telegram')
    expect(pluginInstance.config_json).toBe('{"bot":"abc"}')

    const assignmentCount = Number(
      (
        migrated
          .prepare(
            'SELECT COUNT(*) AS count FROM agent_plugin_instances WHERE plugin_instance_id = ?'
          )
          .get('integration-1') as { count: number }
      ).count
    )
    expect(assignmentCount).toBe(1)

    const marker = migrated
      .prepare(`SELECT status FROM ${PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE} WHERE id = ?`)
      .get(PLUGIN_INSTANCE_CUTOVER_MARKER_ID) as { status: string }
    expect(marker.status).toBe(PLUGIN_INSTANCE_CUTOVER_STATUS.COMPLETED)

    const workItem = migrated
      .prepare('SELECT plugin_instance_id FROM work_items WHERE id = ?')
      .get('work-1') as { plugin_instance_id: string }
    expect(workItem.plugin_instance_id).toBe('integration-1')

    const columns = migrated.prepare('PRAGMA table_info(work_items)').all() as Array<{
      name: string
    }>
    expect(columns.some((col) => col.name === 'integration_id')).toBe(false)
    expect(columns.some((col) => col.name === 'plugin_instance_id')).toBe(true)

    const legacyTableCount = Number(
      (
        migrated
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='integrations'"
          )
          .get() as { count: number }
      ).count
    )
    expect(legacyTableCount).toBe(0)

    migrated.close()
  })

  it('fails fast for dangling legacy assignment rows and marks cutover as failed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nitejar-cutover-fail-'))
    tempDirs.push(dir)
    const dbPath = join(dir, 'db.sqlite')

    const db = new BetterSqlite3(dbPath)
    createLegacySchema(db)

    db.prepare(
      `INSERT INTO integrations (id, type, name, config, scope, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('integration-1', 'telegram', 'Telegram Inbox', '{"bot":"abc"}', 'global', 1, 10, 20)

    db.prepare(
      `INSERT INTO agent_integrations (agent_id, integration_id, created_at) VALUES (?, ?, ?)`
    ).run('agent-1', 'integration-missing', 15)

    db.close()

    expect(() => migrateIntegrationsToPluginInstances({ dbPath })).toThrow(
      /dangling agent_integrations/
    )

    const failedDb = new BetterSqlite3(dbPath)
    const marker = failedDb
      .prepare(`SELECT status FROM ${PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE} WHERE id = ?`)
      .get(PLUGIN_INSTANCE_CUTOVER_MARKER_ID) as { status: string }
    expect(marker.status).toBe(PLUGIN_INSTANCE_CUTOVER_STATUS.FAILED)
    failedDb.close()

    const reportPath = latestBackupReport(dbPath)
    expect(existsSync(reportPath)).toBe(true)

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      status: string
      marker: { status: string }
      error: string
    }
    expect(report.status).toBe('failed')
    expect(report.marker.status).toBe(PLUGIN_INSTANCE_CUTOVER_STATUS.FAILED)
    expect(report.error).toMatch(/dangling agent_integrations/)
  })

  it('returns skipped when legacy integrations table is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nitejar-cutover-skip-'))
    tempDirs.push(dir)
    const dbPath = join(dir, 'db.sqlite')

    const db = new BetterSqlite3(dbPath)
    db.exec('CREATE TABLE plugins (id TEXT PRIMARY KEY)')
    db.close()

    const result = migrateIntegrationsToPluginInstances({ dbPath })
    expect(result).toEqual({
      status: 'skipped',
      reason: 'no-legacy-integrations',
      database: dbPath,
    })
  })

  it('supports backupMode=file-copy for runtime cutover path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nitejar-cutover-file-copy-'))
    tempDirs.push(dir)
    const dbPath = join(dir, 'db.sqlite')

    const db = new BetterSqlite3(dbPath)
    createLegacySchema(db)
    db.prepare(
      `INSERT INTO integrations (id, type, name, config, scope, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('integration-1', 'telegram', 'Telegram Inbox', '{"bot":"abc"}', 'global', 1, 10, 20)
    db.close()

    const result = migrateIntegrationsToPluginInstances({ dbPath, backupMode: 'file-copy' })
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') {
      throw new Error('Expected completed status')
    }

    const backupBytes = readFileSync(result.report.backupSql)
    expect(backupBytes.subarray(0, 16).toString('utf8')).toContain('SQLite format 3')
    expect(existsSync(result.report.reportPath)).toBe(true)
  })
})
