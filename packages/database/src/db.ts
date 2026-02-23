import { Kysely, SqliteDialect, PostgresDialect } from 'kysely'
import { createRequire } from 'module'
import { Pool } from 'pg'
import { existsSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { Database } from './types'
import {
  PLUGIN_INSTANCE_CUTOVER_MARKER_ID,
  PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE,
  PLUGIN_INSTANCE_CUTOVER_STATUS,
} from './plugin-instance-cutover'

// Resolve default SQLite path relative to this package, not CWD
const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_SQLITE_PATH = resolve(__dirname, '..', 'data', 'nitejar.db')

// Use createRequire to load better-sqlite3 dynamically at runtime
// This prevents Next.js/Webpack from trying to bundle the native module
const require = createRequire(import.meta.url)

type SqliteStatement = {
  readonly reader: boolean
  all(parameters?: unknown): unknown[]
  get(parameters?: unknown): unknown
  run(parameters?: unknown): {
    changes: number | bigint
    lastInsertRowid: number | bigint
  }
  iterate(parameters?: unknown): IterableIterator<unknown>
}

// Extended type for better-sqlite3 database with pragma support
type BetterSqlite3Database = {
  close(): void
  prepare(sql: string): SqliteStatement
  pragma(source: string): unknown
}

let db: Kysely<Database> | null = null
let sqliteConnection: BetterSqlite3Database | null = null
let pgPool: Pool | null = null

export type DatabaseType = 'sqlite' | 'postgres'

export function getDatabaseType(): DatabaseType {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    return 'sqlite'
  }
  if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
    return 'postgres'
  }
  return 'sqlite'
}

export function getDb(): Kysely<Database> {
  if (db) {
    return db
  }

  const dbType = getDatabaseType()

  if (dbType === 'postgres') {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL or POSTGRES_URL environment variable is required for Postgres')
    }
    pgPool = new Pool({ connectionString })
    db = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: pgPool,
      }),
    })
  } else {
    // SQLite - load better-sqlite3 dynamically to avoid bundler issues
    const Database = require('better-sqlite3') as new (path: string) => BetterSqlite3Database
    const dbPath = process.env.DATABASE_URL || DEFAULT_SQLITE_PATH
    // Ensure directory exists
    const dir = dirname(dbPath)
    if (dir && dir !== '.' && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    sqliteConnection = new Database(dbPath)
    sqliteConnection.pragma('journal_mode = WAL')
    validatePluginInstanceCutover(sqliteConnection)
    db = new Kysely<Database>({
      dialect: new SqliteDialect({
        database: sqliteConnection,
      }),
    })
  }

  return db
}

function validatePluginInstanceCutover(sqlite: BetterSqlite3Database): void {
  const hasLegacyIntegrations =
    Number(
      (
        sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='integrations'"
          )
          .get() as { count?: number }
      ).count ?? 0
    ) > 0

  if (!hasLegacyIntegrations) {
    return
  }

  const hasMarkerTable =
    Number(
      (
        sqlite
          .prepare(
            `SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='${PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE}'`
          )
          .get() as { count?: number }
      ).count ?? 0
    ) > 0

  if (!hasMarkerTable) {
    throw new Error(
      'Database cutover required: run `pnpm --filter @nitejar/database db:migrate:plugin-instances` before starting the app.'
    )
  }

  const marker = sqlite
    .prepare(`SELECT status FROM ${PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE} WHERE id = ?`)
    .get(PLUGIN_INSTANCE_CUTOVER_MARKER_ID) as { status?: string } | undefined

  if (!marker) {
    throw new Error(
      'Database cutover marker missing: run `pnpm --filter @nitejar/database db:migrate:plugin-instances` and retry.'
    )
  }

  if (marker.status !== PLUGIN_INSTANCE_CUTOVER_STATUS.COMPLETED) {
    throw new Error(
      'Database cutover incomplete: run `pnpm --filter @nitejar/database db:migrate:plugin-instances` and retry.'
    )
  }
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy()
    db = null
  }
  if (pgPool) {
    await pgPool.end()
    pgPool = null
  }
  if (sqliteConnection) {
    sqliteConnection.close()
    sqliteConnection = null
  }
}

// Re-export types
export type { Database } from './types'
