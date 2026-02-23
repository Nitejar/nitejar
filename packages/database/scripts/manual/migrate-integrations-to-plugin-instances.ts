import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import {
  PLUGIN_INSTANCE_CUTOVER_MARKER_ID,
  PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE,
  PLUGIN_INSTANCE_CUTOVER_STATUS,
  type PluginInstanceCutoverStatus,
} from '../../src/plugin-instance-cutover.js'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BetterSqlite3 = require('better-sqlite3') as new (path: string) => {
  pragma: (sql: string) => unknown
  prepare: (sql: string) => {
    all: (...params: unknown[]) => Array<Record<string, unknown>>
    get: (...params: unknown[]) => Record<string, unknown> | undefined
    run: (...params: unknown[]) => { changes: number }
  }
  exec: (sql: string) => void
  transaction: <T>(fn: () => T) => () => T
  close: () => void
}

type SqliteDb = InstanceType<typeof BetterSqlite3>

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_DB_PATH = resolve(__dirname, '..', '..', 'data', 'nitejar.db')

type IntegrationRow = {
  id: string
  type: string
  name: string
  config: string | null
  scope: string
  enabled: number
  created_at: number
  updated_at: number
}

type AssignmentRow = {
  agent_id: string
  integration_id: string
  created_at: number
}

type ColumnBackfill = {
  table: string
  oldColumn: string
  newColumn: string
  sqlType: string
}

type BackfillValidationRow = {
  table: string
  oldColumn: string
  newColumn: string
  oldCount: number
  newCount: number
  unresolvedPluginInstances: number
  copiedRows: number
}

export type PluginInstanceCutoverBackupMode = 'sql-dump' | 'file-copy'

export type PluginInstanceCutoverReport = {
  status: 'completed' | 'failed'
  database: string
  backupDir: string
  backupSql: string
  reportPath: string
  startedAt: number
  finishedAt: number
  pre: {
    counts: {
      integrations: number
      agent_integrations: number
    }
    configHashes: Record<string, string>
  }
  post?: {
    counts: {
      plugin_instances: number
      agent_plugin_instances: number
    }
    configHashes: Record<string, string>
  }
  verification?: {
    configHashesMatch: boolean
    danglingLegacyAssignments: number
    backfill: BackfillValidationRow[]
  }
  marker: {
    table: string
    id: string
    status: PluginInstanceCutoverStatus
  }
  error?: string
}

export type PluginInstanceCutoverRunResult =
  | { status: 'skipped'; reason: 'no-legacy-integrations'; database: string }
  | { status: 'completed'; report: PluginInstanceCutoverReport }

const COLUMN_BACKFILLS: ColumnBackfill[] = [
  {
    table: 'github_installations',
    oldColumn: 'integration_id',
    newColumn: 'plugin_instance_id',
    sqlType: 'TEXT',
  },
  {
    table: 'work_items',
    oldColumn: 'integration_id',
    newColumn: 'plugin_instance_id',
    sqlType: 'TEXT',
  },
  {
    table: 'scheduled_items',
    oldColumn: 'integration_id',
    newColumn: 'plugin_instance_id',
    sqlType: 'TEXT',
  },
  {
    table: 'routines',
    oldColumn: 'target_integration_id',
    newColumn: 'target_plugin_instance_id',
    sqlType: 'TEXT',
  },
  {
    table: 'queue_lanes',
    oldColumn: 'integration_id',
    newColumn: 'plugin_instance_id',
    sqlType: 'TEXT',
  },
  {
    table: 'queue_messages',
    oldColumn: 'integration_id',
    newColumn: 'plugin_instance_id',
    sqlType: 'TEXT',
  },
  {
    table: 'run_dispatches',
    oldColumn: 'integration_id',
    newColumn: 'plugin_instance_id',
    sqlType: 'TEXT',
  },
  {
    table: 'effect_outbox',
    oldColumn: 'integration_id',
    newColumn: 'plugin_instance_id',
    sqlType: 'TEXT',
  },
]

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

function tableExists(db: SqliteDb, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table)
  return Boolean(row)
}

function columnExists(db: SqliteDb, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false
  const rows = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{
    name: string
  }>
  return rows.some((row) => row.name === column)
}

function dropIndexesReferencingColumn(db: SqliteDb, table: string, column: string): void {
  if (!tableExists(db, table)) return

  const indexes = db.prepare(`PRAGMA index_list(${quoteIdentifier(table)})`).all() as Array<{
    name: string
    origin?: string
  }>

  for (const index of indexes) {
    if (!index?.name) continue
    // Skip SQLite autoindexes that back PRIMARY KEY / UNIQUE constraints.
    if (index.origin === 'pk' || index.origin === 'u') continue

    const indexColumns = db
      .prepare(`PRAGMA index_info(${quoteIdentifier(index.name)})`)
      .all() as Array<{ name?: string }>

    if (indexColumns.some((entry) => entry.name === column)) {
      db.exec(`DROP INDEX IF EXISTS ${quoteIdentifier(index.name)}`)
    }
  }
}

function safeLegacyType(type: string): string {
  const normalized = type
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
  return normalized || 'unknown'
}

function pluginIdForIntegrationType(type: string): string {
  if (type === 'telegram') return 'builtin.telegram'
  if (type === 'github') return 'builtin.github'
  return `legacy.${safeLegacyType(type)}`
}

function baseManifest(pluginId: string, name: string): string {
  const setup = {
    configSchema: {
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
    steps: [
      {
        title: 'Review setup details',
        body: 'Validate declared behavior and configure this plugin instance.',
      },
      {
        title: 'Connect credentials',
        body: 'Provide required credentials and webhook settings before enabling.',
      },
    ],
  }

  return JSON.stringify({
    schemaVersion: 1,
    id: pluginId,
    name,
    version: '1.0.0',
    setup,
  })
}

function ensurePluginDefinition(
  db: SqliteDb,
  pluginId: string,
  name: string,
  sourceKind: 'builtin' | 'local'
): void {
  const existing = db.prepare('SELECT id FROM plugins WHERE id = ?').get(pluginId)
  if (existing) return

  const manifestJson = baseManifest(pluginId, name)
  const checksum = sha256(manifestJson)
  const ts = nowEpoch()

  db.prepare(
    `INSERT INTO plugins (
      id, name, enabled, trust_level, source_kind, source_ref,
      current_version, current_checksum, current_install_path,
      manifest_json, config_json, last_load_error, last_loaded_at,
      installed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    pluginId,
    name,
    1,
    sourceKind === 'builtin' ? 'builtin' : 'unknown',
    sourceKind,
    sourceKind,
    '1.0.0',
    checksum,
    `${sourceKind}://${pluginId}`,
    manifestJson,
    null,
    null,
    null,
    ts,
    ts
  )
}

function ensureMarkerTable(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE} (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      completed_at INTEGER NOT NULL,
      details_json TEXT
    );
  `)
}

function ensureRequiredTables(db: SqliteDb): void {
  if (!tableExists(db, 'plugins')) {
    throw new Error('plugins table not found. Run database migrations before manual cutover.')
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_instances (
      id TEXT PRIMARY KEY,
      plugin_id TEXT NOT NULL,
      name TEXT NOT NULL,
      config_json TEXT,
      scope TEXT NOT NULL DEFAULT 'global',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_plugin_instances (
      agent_id TEXT NOT NULL,
      plugin_instance_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (agent_id, plugin_instance_id)
    );
  `)

  ensureMarkerTable(db)
}

function writeMarkerState(
  db: SqliteDb,
  status: PluginInstanceCutoverStatus,
  details: Record<string, unknown>
): void {
  ensureMarkerTable(db)
  const ts = nowEpoch()

  db.prepare(
    `INSERT INTO ${PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE} (id, status, completed_at, details_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       completed_at = excluded.completed_at,
       details_json = excluded.details_json`
  ).run(PLUGIN_INSTANCE_CUTOVER_MARKER_ID, status, ts, JSON.stringify(details))
}

function createBackupArtifacts(
  dbPath: string,
  mode: PluginInstanceCutoverBackupMode
): {
  backupDir: string
  dumpPath: string
  reportPath: string
} {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = resolve(dirname(dbPath), 'backups', `plugin-instance-cutover-${timestamp}`)
  mkdirSync(backupDir, { recursive: true })

  const dumpPath = resolve(backupDir, mode === 'sql-dump' ? 'backup.sql' : 'backup.sqlite')
  const reportPath = resolve(backupDir, 'backup-report.json')

  if (mode === 'file-copy') {
    copyFileSync(dbPath, dumpPath)
  } else {
    const dumpFd = openSync(dumpPath, 'w')
    const dump = spawnSync('sqlite3', [dbPath, '.dump'], {
      stdio: ['ignore', dumpFd, 'pipe'],
      encoding: 'utf8',
    })
    closeSync(dumpFd)

    if (dump.status !== 0) {
      const reason = dump.error?.message || dump.stderr || 'unknown sqlite3 failure'
      throw new Error(`Failed to create .sql backup via sqlite3: ${reason}`)
    }
  }

  if (!existsSync(dumpPath) || statSync(dumpPath).size === 0) {
    throw new Error('Backup verification failed: backup artifact was not created or is empty.')
  }

  return { backupDir, dumpPath, reportPath }
}

function loadLegacyData(db: SqliteDb): {
  integrations: IntegrationRow[]
  assignments: AssignmentRow[]
} {
  const integrations = db
    .prepare(
      'SELECT id, type, name, config, scope, enabled, created_at, updated_at FROM integrations ORDER BY id ASC'
    )
    .all() as IntegrationRow[]

  const assignments = db
    .prepare(
      'SELECT agent_id, integration_id, created_at FROM agent_integrations ORDER BY agent_id ASC'
    )
    .all() as AssignmentRow[]

  return { integrations, assignments }
}

function verifyNoDanglingAssignments(data: {
  integrations: IntegrationRow[]
  assignments: AssignmentRow[]
}): number {
  const integrationIds = new Set(data.integrations.map((row) => row.id))
  let dangling = 0

  for (const assignment of data.assignments) {
    if (!integrationIds.has(assignment.integration_id)) {
      dangling += 1
    }
  }

  return dangling
}

function migrateLegacyRows(
  db: SqliteDb,
  data: { integrations: IntegrationRow[]; assignments: AssignmentRow[] }
): void {
  ensurePluginDefinition(db, 'builtin.telegram', 'Telegram', 'builtin')
  ensurePluginDefinition(db, 'builtin.github', 'GitHub', 'builtin')

  for (const row of data.integrations) {
    const pluginId = pluginIdForIntegrationType(row.type)
    if (pluginId.startsWith('legacy.')) {
      ensurePluginDefinition(db, pluginId, `Legacy ${row.type}`, 'local')
    }

    db.prepare(
      `INSERT INTO plugin_instances (
        id, plugin_id, name, config_json, scope, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        plugin_id = excluded.plugin_id,
        name = excluded.name,
        config_json = excluded.config_json,
        scope = excluded.scope,
        enabled = excluded.enabled,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at`
    ).run(
      row.id,
      pluginId,
      row.name,
      row.config,
      row.scope,
      row.enabled,
      row.created_at,
      row.updated_at
    )
  }

  for (const assignment of data.assignments) {
    db.prepare(
      `INSERT INTO agent_plugin_instances (agent_id, plugin_instance_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(agent_id, plugin_instance_id) DO UPDATE SET created_at = excluded.created_at`
    ).run(assignment.agent_id, assignment.integration_id, assignment.created_at)
  }
}

function executeBackfills(db: SqliteDb): BackfillValidationRow[] {
  const results: BackfillValidationRow[] = []

  for (const mapping of COLUMN_BACKFILLS) {
    if (!tableExists(db, mapping.table)) {
      continue
    }

    const quotedTable = quoteIdentifier(mapping.table)
    const oldColumnExists = columnExists(db, mapping.table, mapping.oldColumn)
    const newColumnExists = columnExists(db, mapping.table, mapping.newColumn)

    if (!oldColumnExists && !newColumnExists) {
      continue
    }

    if (!newColumnExists) {
      db.exec(
        `ALTER TABLE ${quotedTable} ADD COLUMN ${quoteIdentifier(mapping.newColumn)} ${mapping.sqlType}`
      )
    }

    if (oldColumnExists) {
      db.exec(
        `UPDATE ${quotedTable}
         SET ${quoteIdentifier(mapping.newColumn)} = ${quoteIdentifier(mapping.oldColumn)}
         WHERE ${quoteIdentifier(mapping.oldColumn)} IS NOT NULL
           AND ${quoteIdentifier(mapping.newColumn)} IS NULL`
      )
    }

    const oldCount = oldColumnExists
      ? Number(
          (
            db
              .prepare(
                `SELECT COUNT(*) AS count FROM ${quotedTable} WHERE ${quoteIdentifier(mapping.oldColumn)} IS NOT NULL`
              )
              .get() as { count: number }
          ).count
        )
      : 0

    const newCount = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM ${quotedTable} WHERE ${quoteIdentifier(mapping.newColumn)} IS NOT NULL`
          )
          .get() as { count: number }
      ).count
    )

    if (oldColumnExists && newCount < oldCount) {
      throw new Error(
        `Backfill validation failed for ${mapping.table}.${mapping.newColumn}: ${newCount} < ${oldCount}`
      )
    }

    const unresolvedPluginInstances = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM ${quotedTable} t
             LEFT JOIN plugin_instances p ON p.id = t.${quoteIdentifier(mapping.newColumn)}
             WHERE t.${quoteIdentifier(mapping.newColumn)} IS NOT NULL
               AND p.id IS NULL`
          )
          .get() as { count: number }
      ).count
    )

    if (unresolvedPluginInstances > 0) {
      throw new Error(
        `Backfill FK validation failed for ${mapping.table}.${mapping.newColumn}: ${unresolvedPluginInstances} unresolved plugin instance references`
      )
    }

    const copiedRows = oldColumnExists ? Math.max(0, newCount - oldCount) : 0

    results.push({
      table: mapping.table,
      oldColumn: mapping.oldColumn,
      newColumn: mapping.newColumn,
      oldCount,
      newCount,
      unresolvedPluginInstances,
      copiedRows,
    })

    if (oldColumnExists) {
      dropIndexesReferencingColumn(db, mapping.table, mapping.oldColumn)
      db.exec(`ALTER TABLE ${quotedTable} DROP COLUMN ${quoteIdentifier(mapping.oldColumn)}`)
    }
  }

  return results
}

function verifyConfigHashes(
  db: SqliteDb,
  expectedById: Record<string, string>
): { actualById: Record<string, string>; matches: boolean } {
  const rows = db
    .prepare('SELECT id, config_json FROM plugin_instances ORDER BY id ASC')
    .all() as Array<{ id: string; config_json: string | null }>

  const actualById = Object.fromEntries(rows.map((row) => [row.id, sha256(row.config_json ?? '')]))

  for (const [id, expectedHash] of Object.entries(expectedById)) {
    if (actualById[id] !== expectedHash) {
      return { actualById, matches: false }
    }
  }

  return { actualById, matches: true }
}

function writeReport(path: string, report: PluginInstanceCutoverReport): void {
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
}

export function migrateIntegrationsToPluginInstances(options?: {
  dbPath?: string
  backupMode?: PluginInstanceCutoverBackupMode
}): PluginInstanceCutoverRunResult {
  const dbPath = options?.dbPath ?? process.env.DATABASE_URL ?? DEFAULT_DB_PATH
  const backupMode = options?.backupMode ?? 'sql-dump'
  const startedAt = nowEpoch()
  const db = new BetterSqlite3(dbPath)
  db.pragma('foreign_keys = OFF')

  let backupDir = ''
  let backupSql = ''
  let reportPath = ''
  let preCounts = { integrations: 0, agent_integrations: 0 }
  let preConfigHashes: Record<string, string> = {}

  try {
    if (!tableExists(db, 'integrations')) {
      console.log('No legacy integrations table detected; nothing to migrate.')
      return {
        status: 'skipped',
        reason: 'no-legacy-integrations',
        database: dbPath,
      }
    }

    if (!tableExists(db, 'agent_integrations')) {
      throw new Error(
        'Legacy agent_integrations table missing; aborting to avoid partial migration.'
      )
    }

    const backup = createBackupArtifacts(dbPath, backupMode)
    backupDir = backup.backupDir
    backupSql = backup.dumpPath
    reportPath = backup.reportPath
    console.log(`Created SQL backup: ${backupSql}`)

    ensureRequiredTables(db)
    writeMarkerState(db, PLUGIN_INSTANCE_CUTOVER_STATUS.IN_PROGRESS, {
      startedAt,
      database: dbPath,
      backupDir,
      backupSql,
    })

    const legacyData = loadLegacyData(db)
    preCounts = {
      integrations: legacyData.integrations.length,
      agent_integrations: legacyData.assignments.length,
    }
    preConfigHashes = Object.fromEntries(
      legacyData.integrations.map((row) => [row.id, sha256(row.config ?? '')])
    )
    const danglingLegacyAssignments = verifyNoDanglingAssignments(legacyData)
    if (danglingLegacyAssignments > 0) {
      throw new Error(
        `Found ${danglingLegacyAssignments} dangling agent_integrations rows with no matching integrations.id`
      )
    }

    const backfill = db.transaction(() => {
      migrateLegacyRows(db, legacyData)
      const backfillRows = executeBackfills(db)

      db.exec('DROP TABLE IF EXISTS agent_integrations')
      db.exec('DROP TABLE IF EXISTS integrations')

      return backfillRows
    })()

    const { actualById: postConfigHashes, matches: configHashesMatch } = verifyConfigHashes(
      db,
      preConfigHashes
    )

    if (!configHashesMatch) {
      throw new Error(
        'Config checksum verification failed for one or more migrated plugin instances.'
      )
    }

    const pluginInstanceCount = Number(
      (db.prepare('SELECT COUNT(*) AS count FROM plugin_instances').get() as { count: number })
        .count
    )
    const assignmentCount = Number(
      (
        db.prepare('SELECT COUNT(*) AS count FROM agent_plugin_instances').get() as {
          count: number
        }
      ).count
    )
    const migratedAssignmentCount = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM agent_plugin_instances
             WHERE plugin_instance_id IN (SELECT json_each.value FROM json_each(?))`
          )
          .get(JSON.stringify(legacyData.integrations.map((row) => row.id))) as { count: number }
      ).count
    )

    if (migratedAssignmentCount < legacyData.assignments.length) {
      throw new Error(
        `Assignment preservation failed: expected at least ${legacyData.assignments.length}, found ${migratedAssignmentCount}`
      )
    }

    const finishedAt = nowEpoch()
    writeMarkerState(db, PLUGIN_INSTANCE_CUTOVER_STATUS.COMPLETED, {
      startedAt,
      finishedAt,
      integrationCount: legacyData.integrations.length,
      assignmentCount: legacyData.assignments.length,
      backfill,
      verification: {
        configHashesMatch: true,
        danglingLegacyAssignments,
      },
    })

    const report: PluginInstanceCutoverReport = {
      status: 'completed',
      database: dbPath,
      backupDir,
      backupSql,
      reportPath,
      startedAt,
      finishedAt,
      pre: {
        counts: preCounts,
        configHashes: preConfigHashes,
      },
      post: {
        counts: {
          plugin_instances: pluginInstanceCount,
          agent_plugin_instances: assignmentCount,
        },
        configHashes: postConfigHashes,
      },
      verification: {
        configHashesMatch: true,
        danglingLegacyAssignments,
        backfill,
      },
      marker: {
        table: PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE,
        id: PLUGIN_INSTANCE_CUTOVER_MARKER_ID,
        status: PLUGIN_INSTANCE_CUTOVER_STATUS.COMPLETED,
      },
    }

    writeReport(reportPath, report)
    console.log(`Migration complete. Validation report: ${reportPath}`)

    return {
      status: 'completed',
      report,
    }
  } catch (error) {
    const finishedAt = nowEpoch()
    const message = formatError(error)

    if (tableExists(db, PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE) || tableExists(db, 'integrations')) {
      writeMarkerState(db, PLUGIN_INSTANCE_CUTOVER_STATUS.FAILED, {
        startedAt,
        finishedAt,
        error: message,
      })
    }

    if (reportPath) {
      const failedReport: PluginInstanceCutoverReport = {
        status: 'failed',
        database: dbPath,
        backupDir,
        backupSql,
        reportPath,
        startedAt,
        finishedAt,
        pre: {
          counts: preCounts,
          configHashes: preConfigHashes,
        },
        marker: {
          table: PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE,
          id: PLUGIN_INSTANCE_CUTOVER_MARKER_ID,
          status: PLUGIN_INSTANCE_CUTOVER_STATUS.FAILED,
        },
        error: message,
      }

      writeReport(reportPath, failedReport)
    }

    throw error
  } finally {
    db.close()
  }
}

const isDirectRun =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  try {
    migrateIntegrationsToPluginInstances()
  } catch (error) {
    console.error(formatError(error))
    process.exit(1)
  }
}
